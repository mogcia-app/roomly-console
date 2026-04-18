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

type PushDispatchThreadState = {
  category?: string | null;
  lastMessageBody?: string | null;
  lastMessageSender?: string | null;
  roomDisplayName?: string | null;
  roomId?: string | null;
  roomNumber?: string | null;
  unreadCountFront?: number | null;
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

function readNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function truncateNotificationBody(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "新しいメッセージがあります";
  }

  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

async function listHotelNotificationEmails(hotelId: string) {
  const snapshot = await getFirebaseAdminDb()
    .collection("users")
    .where("hotel_id", "==", hotelId)
    .where("is_active", "==", true)
    .get();

  return Array.from(
    new Set(
      snapshot.docs
        .map((doc) => doc.data())
        .filter((data) => data.role === "hotel_admin" || data.role === "hotel_front")
        .map((data) => readString(data.email).trim().toLowerCase())
        .filter(Boolean),
    ),
  );
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

async function sendFrontdeskEmailToHotel(params: {
  body: string;
  hotelId: string;
  threadId: string;
  title: string;
  roomLabel: string;
}) {
  const resendApiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = process.env.FRONTDESK_EMAIL_FROM?.trim() ?? "";
  const replyTo = process.env.FRONTDESK_EMAIL_REPLY_TO?.trim() ?? "";
  const baseUrl = (process.env.FRONTDESK_API_BASE_URL?.trim() ?? "").replace(/\/$/, "");

  if (!resendApiKey || !from) {
    return { recipientCount: 0, sent: false, skipped: true };
  }

  const recipients = await listHotelNotificationEmails(params.hotelId);
  if (recipients.length === 0) {
    return { recipientCount: 0, sent: false, skipped: false };
  }

  const threadUrl = baseUrl ? `${baseUrl}/?threadId=${encodeURIComponent(params.threadId)}` : "";
  const subject = params.title.startsWith("緊急:")
    ? `[Roomly] ${params.title}`
    : `[Roomly] ${params.roomLabel} から新着メッセージ`;
  const safeBody = escapeHtml(params.body);
  const safeRoomLabel = escapeHtml(params.roomLabel);
  const safeTitle = escapeHtml(params.title);
  const safeThreadUrl = escapeHtml(threadUrl);
  const text = [
    params.title,
    "",
    `部屋: ${params.roomLabel}`,
    `内容: ${params.body}`,
    threadUrl ? `管理画面: ${threadUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #1c1917;">
      <h2 style="margin: 0 0 16px; font-size: 20px;">${safeTitle}</h2>
      <p style="margin: 0 0 8px;"><strong>部屋:</strong> ${safeRoomLabel}</p>
      <p style="margin: 0 0 16px;"><strong>内容:</strong><br>${safeBody}</p>
      ${threadUrl ? `<p style="margin: 0;"><a href="${safeThreadUrl}">管理画面で確認する</a></p>` : ""}
    </div>
  `.trim();

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: recipients,
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject,
        text,
        html,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("frontdesk-email-send-error", {
        error: errorText || "unknown-error",
        hotelId: params.hotelId,
        recipientCount: recipients.length,
        threadId: params.threadId,
      });
      return { recipientCount: recipients.length, sent: false, skipped: false };
    }

    return { recipientCount: recipients.length, sent: true, skipped: false };
  } catch (error) {
    console.error("frontdesk-email-send-error", {
      error: error instanceof Error ? error.message : "unknown-error",
      hotelId: params.hotelId,
      recipientCount: recipients.length,
      threadId: params.threadId,
    });
    return { recipientCount: recipients.length, sent: false, skipped: false };
  }
}

export async function dispatchFrontdeskGuestMessagePush(params: {
  dispatchKey: string;
  hotelId: string;
  threadId: string;
  threadState?: PushDispatchThreadState;
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
      params.threadState?.unreadCountFront ??
      (typeof threadData.unread_count_front === "number"
        ? threadData.unread_count_front
        : typeof threadData.unreadCountFront === "number"
          ? threadData.unreadCountFront
          : 0);
    const sender =
      params.threadState?.lastMessageSender ??
      (threadData.last_message_sender === "guest" ||
      threadData.last_message_sender === "ai" ||
      threadData.last_message_sender === "front" ||
      threadData.last_message_sender === "system"
        ? threadData.last_message_sender
        : threadData.lastMessageSender === "guest" ||
            threadData.lastMessageSender === "ai" ||
            threadData.lastMessageSender === "front" ||
            threadData.lastMessageSender === "system"
          ? threadData.lastMessageSender
          : "");

    if (unreadCount <= 0 || (sender !== "guest" && sender !== "ai")) {
      return null;
    }

    transaction.create(dispatchRef, {
      dispatch_key: dispatchKey,
      hotel_id: params.hotelId,
      thread_id: params.threadId,
      created_at: FieldValue.serverTimestamp(),
    });

    const category = readString(params.threadState?.category) || readString(threadData.category);
    const emergencyLabel = isEmergencyCategory(category) ? resolveEmergencyLabel(category) : "";
    const roomId = readString(params.threadState?.roomId) || readString(threadData.room_id) || readString(threadData.roomId);
    const roomNumber = readString(params.threadState?.roomNumber) || readString(threadData.room_number) || readString(threadData.roomNumber) || undefined;
    const roomDisplayName =
      readString(params.threadState?.roomDisplayName) || readString(threadData.room_display_name) || readString(threadData.roomDisplayName) || undefined;
    const lastMessageBody = readString(params.threadState?.lastMessageBody) || readString(threadData.last_message_body);

    const roomLabel = formatRoomLabel(
      roomId,
      roomNumber,
      roomDisplayName,
    );

    return {
      body: truncateNotificationBody(
        lastMessageBody || category || "新しいメッセージがあります",
      ),
      roomLabel,
      title: emergencyLabel
        ? `緊急: ${emergencyLabel}`
        : `${roomLabel} から新着チャット`,
    };
  });

  if (!sendContext) {
    return { dispatched: false, emailSent: false, emailRecipientCount: 0, sentCount: 0, tokenCount: 0 };
  }

  const pushResult = await sendFrontdeskPushToHotel({
    body: sendContext.body,
    hotelId: params.hotelId,
    threadId: params.threadId,
    title: sendContext.title,
  });
  const emailResult = await sendFrontdeskEmailToHotel({
    body: sendContext.body,
    hotelId: params.hotelId,
    roomLabel: sendContext.roomLabel,
    threadId: params.threadId,
    title: sendContext.title,
  });

  await dispatchRef.set(
    {
      email_recipient_count: emailResult.recipientCount,
      email_sent: emailResult.sent,
      email_skipped: emailResult.skipped,
      sent_at: FieldValue.serverTimestamp(),
      sent_count: pushResult.sentCount,
      token_count: pushResult.tokenCount,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    dispatched: true,
    emailRecipientCount: emailResult.recipientCount,
    emailSent: emailResult.sent,
    sentCount: pushResult.sentCount,
    tokenCount: pushResult.tokenCount,
  };
}

export function parsePushDispatchThreadState(input: Record<string, unknown>): PushDispatchThreadState | undefined {
  const threadState: PushDispatchThreadState = {
    unreadCountFront: readNullableNumber(input.unreadCountFront),
    lastMessageSender: readNullableString(input.lastMessageSender),
    lastMessageBody: readNullableString(input.lastMessageBody),
    category: readNullableString(input.category),
    roomId: readNullableString(input.roomId),
    roomNumber: readNullableString(input.roomNumber),
    roomDisplayName: readNullableString(input.roomDisplayName),
  };

  return Object.values(threadState).some((value) => value !== null && value !== undefined) ? threadState : undefined;
}
