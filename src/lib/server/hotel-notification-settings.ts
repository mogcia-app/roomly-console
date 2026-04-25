import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb } from "@/lib/server/firebase-admin";

const HOTEL_NOTIFICATION_SETTINGS_COLLECTION = "hotel_frontdesk_settings";

function normalizeSingleEmail(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

export function normalizeNotificationEmails(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.map((entry) => normalizeSingleEmail(entry)).filter((entry): entry is string => Boolean(entry))),
  );
}

export function parseNotificationEmailsInput(value: unknown) {
  if (!Array.isArray(value)) {
    return {
      invalidEntries: [],
      notificationEmails: [],
    };
  }

  const invalidEntries = value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry && !normalizeSingleEmail(entry));

  return {
    invalidEntries,
    notificationEmails: normalizeNotificationEmails(value),
  };
}

function getHotelNotificationSettingsRef(hotelId: string) {
  return getFirebaseAdminDb().collection(HOTEL_NOTIFICATION_SETTINGS_COLLECTION).doc(hotelId);
}

export async function getHotelNotificationSettings(hotelId: string) {
  const snapshot = await getHotelNotificationSettingsRef(hotelId).get();
  const data = snapshot.data() ?? {};

  return {
    notificationEmails: normalizeNotificationEmails(data.notification_emails ?? data.notificationEmails),
  };
}

export async function updateHotelNotificationSettings(params: {
  hotelId: string;
  notificationEmails: string[];
  updatedBy: string;
}) {
  const notificationEmails = normalizeNotificationEmails(params.notificationEmails);

  await getHotelNotificationSettingsRef(params.hotelId).set(
    {
      hotel_id: params.hotelId,
      notification_emails: notificationEmails,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: params.updatedBy,
    },
    { merge: true },
  );

  return {
    notificationEmails,
  };
}
