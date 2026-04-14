import { FieldValue } from "firebase-admin/firestore";
import { isTranslationRequired, normalizeGuestLanguage, SUPPORTED_GUEST_LANGUAGE_OPTIONS } from "@/lib/frontdesk/languages";
import { getFirebaseAdminDb } from "@/lib/server/firebase-admin";
import { resolveHotelOperationLanguage, translateText } from "@/lib/server/frontdesk-translation";

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, string>;
  }

  const entries = Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => {
    const [, item] = entry;
    return typeof item === "string";
  });
  return Object.fromEntries(entries);
}

function dedupeDocsById(
  docs: Array<{
    id: string;
    data: Record<string, unknown>;
  }>,
) {
  const unique = new Map<string, Record<string, unknown>>();
  for (const doc of docs) {
    if (!unique.has(doc.id)) {
      unique.set(doc.id, doc.data);
    }
  }
  return [...unique.entries()].map(([id, data]) => ({ id, data }));
}

async function listFrontMessagesByThreadId(threadId: string) {
  const db = getFirebaseAdminDb();
  const [snakeSnapshot, camelSnapshot] = await Promise.all([
    db.collection("messages").where("thread_id", "==", threadId).where("sender", "==", "front").get(),
    db.collection("messages").where("threadId", "==", threadId).where("sender", "==", "front").get(),
  ]);

  return dedupeDocsById([
    ...snakeSnapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
    ...camelSnapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
  ]);
}

export function listSupportedGuestLanguages() {
  return SUPPORTED_GUEST_LANGUAGE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));
}

export async function updateGuestLanguageForThread(params: {
  hotelId?: string;
  threadId: string;
  guestLanguage: string;
  retranslateHistory?: boolean;
}) {
  const db = getFirebaseAdminDb();
  const threadRef = db.collection("chat_threads").doc(params.threadId);
  const threadSnapshot = await threadRef.get();

  if (!threadSnapshot.exists) {
    throw new Error("thread-not-found");
  }

  const threadData = threadSnapshot.data() ?? {};
  const threadHotelId = readString(threadData.hotel_id) || readString(threadData.hotelId);

  if (!threadHotelId) {
    throw new Error("thread-hotel-not-found");
  }

  if (params.hotelId && threadHotelId !== params.hotelId) {
    throw new Error("cross-hotel-thread");
  }

  if (readString(threadData.mode) !== "human") {
    throw new Error("unsupported-thread-mode");
  }

  const normalizedGuestLanguage = normalizeGuestLanguage(params.guestLanguage);
  const stayId = readString(threadData.stay_id) || readString(threadData.stayId);
  const stayRef = stayId ? db.collection("stays").doc(stayId) : null;

  await db.runTransaction(async (transaction) => {
    transaction.update(threadRef, {
      guest_language: normalizedGuestLanguage,
      guestLanguage: normalizedGuestLanguage,
      language: normalizedGuestLanguage,
      updated_at: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (stayRef) {
      transaction.set(
        stayRef,
        {
          guest_language: normalizedGuestLanguage,
          guestLanguage: normalizedGuestLanguage,
          language: normalizedGuestLanguage,
          translation_enabled: isTranslationRequired(normalizedGuestLanguage),
          translationEnabled: isTranslationRequired(normalizedGuestLanguage),
          updated_at: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  });

  if (params.retranslateHistory === false) {
    return {
      threadId: params.threadId,
      stayId: stayId || null,
      guestLanguage: normalizedGuestLanguage,
      updatedMessages: 0,
    };
  }

  const messages = await listFrontMessagesByThreadId(params.threadId);
  let updatedMessages = 0;
  let batch = db.batch();
  let operations = 0;

  for (const message of messages) {
    const sourceText = readString(message.data.original_body) || readString(message.data.body);

    if (!sourceText) {
      continue;
    }

    const sourceLanguage = readString(message.data.original_language) || resolveHotelOperationLanguage();
    const translation = await translateText({
      sourceLanguage,
      targetLanguage: normalizedGuestLanguage,
      text: sourceText,
    });

    const snakeTranslations = readObject(message.data.translated_body_guest_by_language);
    const camelTranslations = readObject(message.data.translatedBodyGuestByLanguage);
    const nextTranslations = {
      ...snakeTranslations,
      ...camelTranslations,
      [normalizedGuestLanguage]: translation.text,
    };

    const messageRef = db.collection("messages").doc(message.id);
    batch.update(messageRef, {
      translated_body_guest: translation.text,
      translatedBodyGuest: translation.text,
      translated_language_guest: normalizedGuestLanguage,
      translatedLanguageGuest: normalizedGuestLanguage,
      translation_state: translation.state,
      translationState: translation.state,
      translated_body_guest_by_language: nextTranslations,
      translatedBodyGuestByLanguage: nextTranslations,
    });
    updatedMessages += 1;
    operations += 1;

    if (operations >= 400) {
      await batch.commit();
      batch = db.batch();
      operations = 0;
    }
  }

  if (operations > 0) {
    await batch.commit();
  }

  return {
    threadId: params.threadId,
    stayId: stayId || null,
    guestLanguage: normalizedGuestLanguage,
    updatedMessages,
  };
}
