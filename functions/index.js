import { createHash } from "node:crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();
const messaging = getMessaging();

function readString(value) {
  return typeof value === "string" ? value : "";
}

function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function buildDispatchDocId(dispatchKey) {
  return createHash("sha256").update(dispatchKey).digest("hex");
}

function buildSubscriptionDocId(token) {
  return createHash("sha256").update(token).digest("hex");
}

function timestampToKeyPart(value) {
  if (!value) {
    return "";
  }

  if (typeof value.toMillis === "function") {
    return String(value.toMillis());
  }

  if (typeof value.seconds === "number") {
    return `${value.seconds}:${typeof value.nanoseconds === "number" ? value.nanoseconds : 0}`;
  }

  if (typeof value._seconds === "number") {
    return `${value._seconds}:${typeof value._nanoseconds === "number" ? value._nanoseconds : 0}`;
  }

  if (value instanceof Date) {
    return String(value.getTime());
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return "";
}

function buildDispatchKey(threadId, threadData) {
  const timestamp =
    timestampToKeyPart(threadData.last_message_at) ||
    timestampToKeyPart(threadData.lastMessageAt);

  return timestamp ? `${threadId}:timestamp:${timestamp}` : "";
}

function getNestedValue(record, path) {
  const segments = path.split(".");
  let current = record;

  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function pickFirstValue(record, paths) {
  for (const path of paths) {
    const value = getNestedValue(record, path);
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
}

function truncateNotificationBody(value) {
  const trimmed = readString(value).trim();
  if (!trimmed) {
    return "新しいメッセージがあります";
  }

  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

function formatRoomLabel(roomId, roomNumber, roomDisplayName) {
  if (readString(roomDisplayName).trim()) {
    return readString(roomDisplayName).trim();
  }

  if (readString(roomNumber).trim()) {
    return `${readString(roomNumber).trim()}号室`;
  }

  if (readString(roomId).trim()) {
    return readString(roomId).trim();
  }

  return "客室";
}

function escapeHtml(value) {
  return readString(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isEmergencyCategory(category) {
  return readString(category).startsWith("emergency_");
}

function resolveEmergencyLabel(category) {
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

function normalizeSingleEmail(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function normalizeNotificationEmails(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.map((entry) => normalizeSingleEmail(entry)).filter(Boolean)));
}

async function resolveHotelLabel(hotelId) {
  const snapshot = await db.collection("hearing_sheets").doc(hotelId).get();
  const data = snapshot.data() || {};

  return (
    readString(
      pickFirstValue(data, [
        "hotel_name",
        "hotelName",
        "property_name",
        "propertyName",
        "basic_info.name",
        "basicInfo.name",
        "facility_name",
        "facilityName",
        "name",
      ]),
    ).trim() || hotelId
  );
}

async function resolveGuestName(stayId) {
  if (!stayId) {
    return "";
  }

  const snapshot = await db.collection("stays").doc(stayId).get();
  const data = snapshot.data() || {};
  return readString(data.guest_name || data.guestName).trim();
}

function buildEmailSubject({ emergencyLabel, hotelLabel, roomLabel }) {
  if (emergencyLabel) {
    return `[Roomly][緊急] ${hotelLabel} ${roomLabel} ${emergencyLabel}`;
  }

  return `[Roomly] ${hotelLabel} ${roomLabel} から新着メッセージ`;
}

async function getNotificationEmails(hotelId) {
  const settingsSnapshot = await db.collection("hotel_frontdesk_settings").doc(hotelId).get();
  const settings = settingsSnapshot.data() || {};
  const configuredEmails = normalizeNotificationEmails(settings.notification_emails || settings.notificationEmails);

  if (configuredEmails.length > 0) {
    return configuredEmails;
  }

  const usersSnapshot = await db
    .collection("users")
    .where("hotel_id", "==", hotelId)
    .where("is_active", "==", true)
    .get();

  return Array.from(
    new Set(
      usersSnapshot.docs
        .map((doc) => doc.data())
        .filter((data) => data.role === "hotel_admin" || data.role === "hotel_front")
        .map((data) => normalizeSingleEmail(data.email))
        .filter(Boolean),
    ),
  );
}

async function deactivateSubscriptionsByToken(tokens) {
  if (tokens.length === 0) {
    return;
  }

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

async function sendPushToHotel({ body, hotelId, threadId, title }) {
  const snapshot = await db
    .collection("frontdesk_push_subscriptions")
    .where("hotel_id", "==", hotelId)
    .where("active", "==", true)
    .get();

  const tokens = snapshot.docs.map((doc) => readString(doc.data().token)).filter(Boolean);
  if (tokens.length === 0) {
    return { sentCount: 0, tokenCount: 0 };
  }

  const response = await messaging.sendEachForMulticast({
    tokens,
    data: {
      body,
      threadId,
      title,
      type: "frontdesk_guest_message",
      url: `/?threadId=${encodeURIComponent(threadId)}`,
    },
    webpush: {
      fcmOptions: {
        link: `/?threadId=${encodeURIComponent(threadId)}`,
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

    const code = item.error && item.error.code ? item.error.code : "";
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
      return [tokens[index]];
    }

    return [];
  });

  await deactivateSubscriptionsByToken(invalidTokens);

  return {
    sentCount: response.successCount,
    tokenCount: tokens.length,
  };
}

async function sendEmailToHotel({ body, guestName, hotelId, hotelLabel, roomLabel, threadId, title }) {
  const resendApiKey = readString(process.env.RESEND_API_KEY).trim();
  const from = readString(process.env.FRONTDESK_EMAIL_FROM).trim();
  const replyTo = readString(process.env.FRONTDESK_EMAIL_REPLY_TO).trim();
  const baseUrl = readString(process.env.FRONTDESK_API_BASE_URL).trim().replace(/\/$/, "");

  if (!resendApiKey || !from) {
    return { recipientCount: 0, sent: false, skipped: true };
  }

  const recipients = await getNotificationEmails(hotelId);
  if (recipients.length === 0) {
    return { recipientCount: 0, sent: false, skipped: false };
  }

  const threadUrl = baseUrl ? `${baseUrl}/?threadId=${encodeURIComponent(threadId)}` : "";
  const emergencyLabel = title.startsWith("緊急:") ? title.replace(/^緊急:\s*/, "") : "";
  const subject = buildEmailSubject({ emergencyLabel, hotelLabel, roomLabel });
  const safeBody = escapeHtml(body);
  const safeHotelLabel = escapeHtml(hotelLabel);
  const safeGuestName = escapeHtml(guestName || "");
  const safeRoomLabel = escapeHtml(roomLabel);
  const safeTitle = escapeHtml(title);
  const safeThreadUrl = escapeHtml(threadUrl);

  const text = [
    title,
    "",
    `ホテル: ${hotelLabel}`,
    `部屋: ${roomLabel}`,
    guestName ? `ゲスト: ${guestName}様` : "",
    `内容: ${body}`,
    threadUrl ? `管理画面: ${threadUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #1c1917;">
      <h2 style="margin: 0 0 16px; font-size: 20px;">${safeTitle}</h2>
      <p style="margin: 0 0 8px;"><strong>ホテル:</strong> ${safeHotelLabel}</p>
      <p style="margin: 0 0 8px;"><strong>部屋:</strong> ${safeRoomLabel}</p>
      ${guestName ? `<p style="margin: 0 0 8px;"><strong>ゲスト:</strong> ${safeGuestName} 様</p>` : ""}
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

    return {
      recipientCount: recipients.length,
      sent: response.ok,
      skipped: false,
    };
  } catch (error) {
    console.error("frontdesk-email-send-error", {
      error: error instanceof Error ? error.message : "unknown-error",
      hotelId,
      recipientCount: recipients.length,
      threadId,
    });

    return {
      recipientCount: recipients.length,
      sent: false,
      skipped: false,
    };
  }
}

export const dispatchGuestMessageNotifications = onDocumentWritten(
  {
    document: "chat_threads/{threadId}",
    region: "asia-northeast1",
    retry: false,
  },
  async (event) => {
    const afterData = event.data.after.exists ? event.data.after.data() : null;
    const beforeData = event.data.before.exists ? event.data.before.data() : null;

    if (!afterData) {
      return;
    }

    const threadId = event.params.threadId;
    const hotelId = readString(afterData.hotel_id) || readString(afterData.hotelId);
    const sender =
      readString(afterData.last_message_sender) ||
      readString(afterData.lastMessageSender);
    const unreadCount = readNumber(afterData.unread_count_front ?? afterData.unreadCountFront);
    const beforeSender =
      readString(beforeData && (beforeData.last_message_sender || beforeData.lastMessageSender));
    const beforeUnreadCount = readNumber(beforeData && (beforeData.unread_count_front ?? beforeData.unreadCountFront));

    if (!hotelId) {
      return;
    }

    if (unreadCount <= 0 || (sender !== "guest" && sender !== "ai")) {
      return;
    }

    const dispatchKey = buildDispatchKey(threadId, afterData);
    if (!dispatchKey) {
      return;
    }

    const sameMessageAsBefore =
      beforeUnreadCount > 0 &&
      beforeSender === sender &&
      buildDispatchKey(threadId, beforeData || {}) === dispatchKey;

    if (sameMessageAsBefore) {
      return;
    }

    const dispatchRef = db.collection("frontdesk_push_dispatches").doc(buildDispatchDocId(dispatchKey));
    const roomId = readString(afterData.room_id) || readString(afterData.roomId);
    const roomNumber = readString(afterData.room_number) || readString(afterData.roomNumber);
    const roomDisplayName = readString(afterData.room_display_name) || readString(afterData.roomDisplayName);
    const stayId = readString(afterData.stay_id) || readString(afterData.stayId);
    const category = readString(afterData.category);
    const emergencyLabel = isEmergencyCategory(category) ? resolveEmergencyLabel(category) : "";
    const roomLabel = formatRoomLabel(roomId, roomNumber, roomDisplayName);
    const body = truncateNotificationBody(
      readString(afterData.last_message_body) || readString(afterData.lastMessageBody) || category,
    );
    const title = emergencyLabel ? `緊急: ${emergencyLabel}` : `${roomLabel} から新着チャット`;

    const sendContext = await db.runTransaction(async (transaction) => {
      const dispatchSnapshot = await transaction.get(dispatchRef);
      if (dispatchSnapshot.exists) {
        return null;
      }

      transaction.create(dispatchRef, {
        created_at: FieldValue.serverTimestamp(),
        dispatch_key: dispatchKey,
        hotel_id: hotelId,
        thread_id: threadId,
      });

      return { body, roomLabel, title };
    });

    if (!sendContext) {
      return;
    }

    const [hotelLabel, guestName] = await Promise.all([
      resolveHotelLabel(hotelId),
      resolveGuestName(stayId),
    ]);

    const [pushResult, emailResult] = await Promise.all([
      sendPushToHotel({
        body: sendContext.body,
        hotelId,
        threadId,
        title: sendContext.title,
      }),
      sendEmailToHotel({
        body: sendContext.body,
        guestName,
        hotelId,
        hotelLabel,
        roomLabel: sendContext.roomLabel,
        threadId,
        title: sendContext.title,
      }),
    ]);

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
  },
);
