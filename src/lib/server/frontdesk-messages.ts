import { FieldValue } from "firebase-admin/firestore";
import type { ChatThreadRecord } from "@/lib/frontdesk/types";
import { getFirebaseAdminDb } from "@/lib/server/firebase-admin";
import {
  buildTranslationPayload,
  resolveHotelOperationLanguage,
  translateText,
} from "@/lib/server/frontdesk-translation";

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function resolveGuestLanguage(thread: Omit<ChatThreadRecord, "id">) {
  const threadLanguage = readString(thread.guest_language);
  if (threadLanguage) {
    return threadLanguage;
  }

  const stayId = readString(thread.stay_id);
  if (!stayId) {
    return resolveHotelOperationLanguage();
  }

  const staySnapshot = await getFirebaseAdminDb().collection("stays").doc(stayId).get();
  if (!staySnapshot.exists) {
    return resolveHotelOperationLanguage();
  }

  const stayData = staySnapshot.data() ?? {};
  return (
    readString(stayData.guest_language) ||
    readString(stayData.language) ||
    resolveHotelOperationLanguage()
  );
}

export async function saveFrontDeskMessage(params: {
  threadId: string;
  hotelId: string;
  staffUserId: string;
  body: string;
}) {
  const adminDb = getFirebaseAdminDb();
  const trimmedBody = params.body.trim();

  if (!trimmedBody) {
    throw new Error("empty-message");
  }

  const threadRef = adminDb.collection("chat_threads").doc(params.threadId);
  const messageRef = adminDb.collection("messages").doc();
  const threadSnapshot = await threadRef.get();

  if (!threadSnapshot.exists) {
    throw new Error("thread-not-found");
  }

  const thread = threadSnapshot.data() as Omit<ChatThreadRecord, "id">;

  if (thread.hotel_id !== params.hotelId) {
    throw new Error("cross-hotel-thread");
  }

  if (thread.mode !== "human") {
    throw new Error("unsupported-thread-mode");
  }

  if (thread.status === "resolved") {
    throw new Error("thread-resolved");
  }

  if (thread.status === "in_progress" && thread.assigned_to && thread.assigned_to !== params.staffUserId) {
    throw new Error("thread-assigned");
  }

  const hotelLanguage = resolveHotelOperationLanguage();
  const guestLanguage = await resolveGuestLanguage(thread);
  const translation = await translateText({
    sourceLanguage: hotelLanguage,
    targetLanguage: guestLanguage,
    text: trimmedBody,
  });
  const payload = buildTranslationPayload({
    body: trimmedBody,
    guestLanguage: translation.targetLanguage,
    hotelLanguage,
    translatedGuestBody: translation.text,
    translationState: translation.state,
  });

  await adminDb.runTransaction(async (transaction) => {
    transaction.set(messageRef, {
      thread_id: params.threadId,
      stay_id: thread.stay_id ?? thread.stayId ?? null,
      room_id: thread.room_id ?? thread.roomId ?? null,
      sender: "front",
      timestamp: FieldValue.serverTimestamp(),
      ...payload,
    });

    transaction.update(threadRef, {
      status: "in_progress",
      assigned_to: params.staffUserId,
      assigned_at: thread.assigned_at ?? FieldValue.serverTimestamp(),
      guest_language: thread.guest_language ?? translation.targetLanguage,
      last_message_body: payload.body,
      last_message_at: FieldValue.serverTimestamp(),
      last_message_sender: "front",
      unread_count_front: 0,
      updated_at: FieldValue.serverTimestamp(),
    });
  });

  return {
    id: messageRef.id,
    threadId: params.threadId,
    translationState: translation.state,
  };
}
