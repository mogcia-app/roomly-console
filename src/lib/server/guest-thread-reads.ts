import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb } from "@/lib/server/firebase-admin";

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function hasGuestReadMarker(data: Record<string, unknown>) {
  return Boolean(
    data.read_at_guest ||
      data.readAtGuest ||
      data.read_at ||
      data.readAt ||
      data.seen_at_guest ||
      data.seenAtGuest,
  );
}

export async function markGuestThreadMessagesRead(params: {
  hotelId: string;
  threadId: string;
  messageIds?: string[];
}) {
  const adminDb = getFirebaseAdminDb();
  const threadRef = adminDb.collection("chat_threads").doc(params.threadId);
  const threadSnapshot = await threadRef.get();

  if (!threadSnapshot.exists) {
    throw new Error("thread-not-found");
  }

  const threadData = threadSnapshot.data() ?? {};
  const threadHotelId = readString(threadData.hotel_id) || readString(threadData.hotelId);

  if (!threadHotelId || threadHotelId !== params.hotelId) {
    throw new Error("cross-hotel-thread");
  }

  const messageIdFilter = new Set((params.messageIds ?? []).filter((messageId) => typeof messageId === "string" && messageId));
  const messagesSnapshot = await adminDb
    .collection("messages")
    .where("thread_id", "==", params.threadId)
    .get();

  const targetMessages = messagesSnapshot.docs.filter((docSnapshot) => {
    const data = docSnapshot.data() as Record<string, unknown>;
    if (data.sender !== "guest") {
      return false;
    }

    if (hasGuestReadMarker(data)) {
      return false;
    }

    if (messageIdFilter.size > 0 && !messageIdFilter.has(docSnapshot.id)) {
      return false;
    }

    return true;
  });

  if (targetMessages.length === 0) {
    return {
      ok: true as const,
      threadId: params.threadId,
      updatedCount: 0,
    };
  }

  const batch = adminDb.batch();
  const serverTimestamp = FieldValue.serverTimestamp();

  for (const docSnapshot of targetMessages) {
    batch.update(docSnapshot.ref, {
      read_at_guest: serverTimestamp,
      readAtGuest: serverTimestamp,
    });
  }

  await batch.commit();

  return {
    ok: true as const,
    threadId: params.threadId,
    updatedCount: targetMessages.length,
  };
}
