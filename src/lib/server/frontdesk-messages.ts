import { FieldValue } from "firebase-admin/firestore";
import type { ChatThreadRecord } from "@/lib/frontdesk/types";
import { normalizeGuestLanguage } from "@/lib/frontdesk/languages";
import { getFirebaseAdminDb } from "@/lib/server/firebase-admin";
import {
  buildTranslationPayload,
  resolveHotelOperationLanguage,
  translateText,
} from "@/lib/server/frontdesk-translation";

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function buildMessagePayload(params: {
  threadId: string;
  stayId: string | null;
  roomId: string | null;
  translationPayload: ReturnType<typeof buildTranslationPayload>;
  imageUrl?: string;
  imageAlt?: string;
}) {
  return {
    thread_id: params.threadId,
    threadId: params.threadId,
    stay_id: params.stayId,
    stayId: params.stayId,
    room_id: params.roomId,
    roomId: params.roomId,
    sender: "front",
    timestamp: FieldValue.serverTimestamp(),
    body: params.translationPayload.body,
    original_body: params.translationPayload.original_body,
    originalBody: params.translationPayload.original_body,
    original_language: params.translationPayload.original_language,
    originalLanguage: params.translationPayload.original_language,
    translated_body_front: params.translationPayload.translated_body_front,
    translatedBodyFront: params.translationPayload.translated_body_front,
    translated_language_front: params.translationPayload.translated_language_front,
    translatedLanguageFront: params.translationPayload.translated_language_front,
    translated_body_guest: params.translationPayload.translated_body_guest,
    translatedBodyGuest: params.translationPayload.translated_body_guest,
    translated_language_guest: params.translationPayload.translated_language_guest,
    translatedLanguageGuest: params.translationPayload.translated_language_guest,
    translation_state: params.translationPayload.translation_state,
    translationState: params.translationPayload.translation_state,
    image_url: params.imageUrl ?? null,
    imageUrl: params.imageUrl ?? null,
    image_alt: params.imageAlt ?? null,
    imageAlt: params.imageAlt ?? null,
  };
}

type SupportedTranslationKey = "en" | "zh-CN" | "zh-TW" | "ko" | "ja";

type FrontDeskTranslations = Partial<Record<SupportedTranslationKey, string>>;

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveProvidedGuestTranslation(params: {
  guestLanguage: string;
  hotelLanguage: string;
  translations?: FrontDeskTranslations;
}) {
  const normalizedGuestLanguage = normalizeGuestLanguage(params.guestLanguage);
  const translations = params.translations ?? {};
  const provided = normalizeOptionalString(translations[normalizedGuestLanguage]);

  if (!provided) {
    return null;
  }

  return {
    text: provided,
    targetLanguage: normalizedGuestLanguage,
    state: normalizedGuestLanguage === params.hotelLanguage ? "not_required" : "ready",
  } as const;
}

async function resolveGuestLanguage(thread: Omit<ChatThreadRecord, "id">) {
  const rawThread = thread as Omit<ChatThreadRecord, "id"> & Record<string, unknown>;
  const threadLanguage = readString(thread.guest_language) || readString(rawThread.guestLanguage);
  const stayId = readString(thread.stay_id) || readString(thread.stayId);
  if (!stayId) {
    return threadLanguage || resolveHotelOperationLanguage();
  }

  const staySnapshot = await getFirebaseAdminDb().collection("stays").doc(stayId).get();
  if (!staySnapshot.exists) {
    return threadLanguage || resolveHotelOperationLanguage();
  }

  const stayData = (staySnapshot.data() ?? {}) as Record<string, unknown>;
  return (
    readString(stayData.guest_language) ||
    readString(stayData.guestLanguage) ||
    readString(stayData.language) ||
    threadLanguage ||
    resolveHotelOperationLanguage()
  );
}

export async function saveFrontDeskMessage(params: {
  threadId: string;
  hotelId: string;
  staffUserId?: string | null;
  body: string;
  imageUrl?: string;
  imageAlt?: string;
  translations?: FrontDeskTranslations;
}) {
  const adminDb = getFirebaseAdminDb();
  const trimmedBody = params.body.trim();
  const imageUrl = normalizeOptionalString(params.imageUrl);
  const imageAlt = normalizeOptionalString(params.imageAlt);

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

  if (params.staffUserId && thread.status === "in_progress" && thread.assigned_to && thread.assigned_to !== params.staffUserId) {
    throw new Error("thread-assigned");
  }

  const hotelLanguage = resolveHotelOperationLanguage();
  const guestLanguage = await resolveGuestLanguage(thread);
  const providedGuestTranslation = resolveProvidedGuestTranslation({
    guestLanguage,
    hotelLanguage,
    translations: params.translations,
  });
  const translation =
    providedGuestTranslation ??
    (await translateText({
      sourceLanguage: hotelLanguage,
      targetLanguage: guestLanguage,
      text: trimmedBody,
    }));
  const payload = buildTranslationPayload({
    body: trimmedBody,
    guestLanguage: translation.targetLanguage,
    hotelLanguage,
    translatedGuestBody: translation.text,
    translationState: translation.state,
  });

  await adminDb.runTransaction(async (transaction) => {
    const stayId = thread.stay_id ?? thread.stayId ?? null;
    const roomId = thread.room_id ?? thread.roomId ?? null;

    transaction.set(
      messageRef,
      buildMessagePayload({
        threadId: params.threadId,
        stayId,
        roomId,
        translationPayload: payload,
        imageUrl,
        imageAlt,
      }),
    );

    const threadUpdate: Record<string, unknown> = {
      status: "in_progress",
      handoff_status: "accepted",
      handoffStatus: "accepted",
      handoff_accepted_at: thread.handoff_accepted_at ?? FieldValue.serverTimestamp(),
      handoffAcceptedAt: thread.handoff_accepted_at ?? FieldValue.serverTimestamp(),
      guest_language: guestLanguage,
      guestLanguage: guestLanguage,
      last_message_body: payload.body,
      lastMessageBody: payload.body,
      last_message_at: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      last_message_sender: "front",
      lastMessageSender: "front",
      unread_count_front: 0,
      unreadCountFront: 0,
      unread_count_guest: FieldValue.increment(1),
      unreadCountGuest: FieldValue.increment(1),
      updated_at: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (params.staffUserId) {
      threadUpdate.assigned_to = params.staffUserId;
      threadUpdate.assignedTo = params.staffUserId;
      threadUpdate.assigned_at = thread.assigned_at ?? FieldValue.serverTimestamp();
      threadUpdate.assignedAt = thread.assigned_at ?? FieldValue.serverTimestamp();
    }

    transaction.update(threadRef, threadUpdate);
  });

  return {
    id: messageRef.id,
    threadId: params.threadId,
    translationState: translation.state,
  };
}
