import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { formatRoomLabel } from "@/lib/frontdesk/format";
import { getFirebaseAdminDb, getFirebaseAdminMessaging } from "@/lib/server/firebase-admin";

type PushSubscriptionRecord = {
  token: string;
  hotel_id: string;
  user_id: string;
  user_agent?: string;
  active: boolean;
};

function buildSubscriptionDocId(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function buildDispatchDocId(dispatchKey: string) {
  return createHash("sha256").update(dispatchKey).digest("hex");
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function truncateNotificationBody(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "新しいメッセージがあります";
  }

  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

function isEmergencyCategory(category: string) {
  return category.startsWith("emergency_");
}

function resolveEmergencyLabel(category: string) {
  switch (category) {
    case "emergency_medical":
      return "体調不良";
    case "emergency_fire":
      return "火災・事故";
    case "emergency_safety":
      return "安全トラブル";
    case "emergency_other":
      return "その他緊急";
    default:
      return "緊急";
  }
}

export function buildFrontdeskGuestPushDispatchKey(params: {
  messageId?: string | null;
  threadId: string;
  timestamp?: string | number | null;
}) {
  const messageId = (params.messageId ?? "").trim();
  if (messageId) {
    return `${params.threadId}:message:${messageId}`;
  }

  const timestamp = `${params.timestamp ?? ""}`.trim();
  if (timestamp) {
    return `${params.threadId}:timestamp:${timestamp}`;
  }

  throw new Error("missing-dispatch-key-source");
}

async function listActiveSubscriptionDocs(hotelId: string) {
  const snapshot = await getFirebaseAdminDb()
    .collection("frontdesk_push_subscriptions")
    .where("hotel_id", "==", hotelId)
    .where("active", "==", true)
    .get();

  return snapshot.docs;
}

async function deactivateSubscriptionsByToken(tokens: string[]) {
  if (tokens.length === 0) {
    return;
  }

  const db = getFirebaseAdminDb();
  const batch = db.batch();

  for (const token of tokens) {
    batch.set(
      db.collection("frontdesk_push_subscriptions").doc(buildSubscriptionDocId(token)),
      {
        active: false,
        invalidated_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  await batch.commit();
}

export async function registerFrontdeskPushSubscription(params: {
  hotelId: string;
  token: string;
  userAgent?: string;
  userId: string;
}) {
  const trimmedToken = params.token.trim();
  if (!trimmedToken) {
    throw new Error("missing-push-token");
  }

  await getFirebaseAdminDb()
    .collection("frontdesk_push_subscriptions")
    .doc(buildSubscriptionDocId(trimmedToken))
    .set(
      {
        token: trimmedToken,
        hotel_id: params.hotelId,
        user_id: params.userId,
        user_agent: params.userAgent ?? "",
        active: true,
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      } satisfies PushSubscriptionRecord & Record<string, unknown>,
      { merge: true },
    );
}

export async function unregisterFrontdeskPushSubscription(params: {
  hotelId: string;
  token: string;
  userId: string;
}) {
  const trimmedToken = params.token.trim();
  if (!trimmedToken) {
    throw new Error("missing-push-token");
  }

  await getFirebaseAdminDb()
    .collection("frontdesk_push_subscriptions")
    .doc(buildSubscriptionDocId(trimmedToken))
    .set(
      {
        hotel_id: params.hotelId,
        user_id: params.userId,
        active: false,
        updated_at: FieldValue.serverTimestamp(),
        deleted_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

async function sendFrontdeskPushToHotel(params: {
  body: string;
  hotelId: string;
  threadId: string;
  title: string;
}) {
  const docs = await listActiveSubscriptionDocs(params.hotelId);
  const tokens = docs
    .map((doc) => readString(doc.data().token))
    .filter(Boolean);

  if (tokens.length === 0) {
    return { sentCount: 0, tokenCount: 0 };
  }

  try {
    const response = await getFirebaseAdminMessaging().sendEachForMulticast({
      tokens,
      data: {
        body: params.body,
        threadId: params.threadId,
        title: params.title,
        type: "frontdesk_guest_message",
        url: `/?threadId=${encodeURIComponent(params.threadId)}`,
      },
      webpush: {
        fcmOptions: {
          link: `/?threadId=${encodeURIComponent(params.threadId)}`,
        },
        headers: {
          Urgency: "high",
        },
      },
    });

    const invalidTokens = response.responses.flatMap((item, index) => {
      if (item.success) {
        return [];
      }

      const code = item.error?.code ?? "";
      console.error("frontdesk-push-delivery-failed", {
        code,
        hotelId: params.hotelId,
        message: item.error?.message ?? "unknown-error",
        threadId: params.threadId,
        tokenHash: buildSubscriptionDocId(tokens[index] ?? ""),
      });

      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        return [tokens[index]];
      }

      return [];
    });

    await deactivateSubscriptionsByToken(invalidTokens);

    return {
      sentCount: response.successCount,
      tokenCount: tokens.length,
    };
  } catch (error) {
    console.error("frontdesk-push-send-error", {
      error: error instanceof Error ? error.message : "unknown-error",
      hotelId: params.hotelId,
      threadId: params.threadId,
      tokenCount: tokens.length,
    });
    throw error;
  }
}

export async function dispatchFrontdeskGuestMessagePush(params: {
  dispatchKey: string;
  hotelId: string;
  threadId: string;
}) {
  const dispatchKey = params.dispatchKey.trim();
  if (!dispatchKey) {
    throw new Error("missing-dispatch-key");
  }

  const db = getFirebaseAdminDb();
  const threadRef = db.collection("chat_threads").doc(params.threadId);
  const dispatchRef = db.collection("frontdesk_push_dispatches").doc(buildDispatchDocId(dispatchKey));

  const sendContext = await db.runTransaction(async (transaction) => {
    const [threadSnapshot, dispatchSnapshot] = await Promise.all([
      transaction.get(threadRef),
      transaction.get(dispatchRef),
    ]);

    if (!threadSnapshot.exists) {
      throw new Error("thread-not-found");
    }

    if (dispatchSnapshot.exists) {
      return null;
    }

    const threadData = (threadSnapshot.data() ?? {}) as Record<string, unknown>;
    const threadHotelId = readString(threadData.hotel_id) || readString(threadData.hotelId);

    if (threadHotelId !== params.hotelId) {
      throw new Error("cross-hotel-thread");
    }

    const unreadCount =
      typeof threadData.unread_count_front === "number"
        ? threadData.unread_count_front
        : typeof threadData.unreadCountFront === "number"
          ? threadData.unreadCountFront
          : 0;
    const sender =
      threadData.last_message_sender === "guest" ||
      threadData.last_message_sender === "ai" ||
      threadData.last_message_sender === "front" ||
      threadData.last_message_sender === "system"
        ? threadData.last_message_sender
        : threadData.lastMessageSender === "guest" ||
            threadData.lastMessageSender === "ai" ||
            threadData.lastMessageSender === "front" ||
            threadData.lastMessageSender === "system"
          ? threadData.lastMessageSender
          : "";

    if (unreadCount <= 0 || (sender !== "guest" && sender !== "ai")) {
      return null;
    }

    transaction.create(dispatchRef, {
      dispatch_key: dispatchKey,
      hotel_id: params.hotelId,
      thread_id: params.threadId,
      created_at: FieldValue.serverTimestamp(),
    });

    const category = readString(threadData.category);
    const emergencyLabel = isEmergencyCategory(category) ? resolveEmergencyLabel(category) : "";

    return {
      body: truncateNotificationBody(
        readString(threadData.last_message_body) || readString(threadData.category) || "新しいメッセージがあります",
      ),
      title: emergencyLabel
        ? `緊急: ${emergencyLabel}`
        : `${formatRoomLabel(
            readString(threadData.room_id) || readString(threadData.roomId),
            readString(threadData.room_number) || readString(threadData.roomNumber) || undefined,
            readString(threadData.room_display_name) || readString(threadData.roomDisplayName) || undefined,
          )} から新着チャット`,
    };
  });

  if (!sendContext) {
    return { dispatched: false, sentCount: 0, tokenCount: 0 };
  }

  const result = await sendFrontdeskPushToHotel({
    body: sendContext.body,
    hotelId: params.hotelId,
    threadId: params.threadId,
    title: sendContext.title,
  });

  await dispatchRef.set(
    {
      sent_at: FieldValue.serverTimestamp(),
      sent_count: result.sentCount,
      token_count: result.tokenCount,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    dispatched: true,
    sentCount: result.sentCount,
    tokenCount: result.tokenCount,
  };
}
