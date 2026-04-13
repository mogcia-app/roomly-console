import { getFirebaseAdminDb } from "@/lib/server/firebase-admin";
import {
  OPERATIONS_INFO_KEYS,
  createEmptyOperationsInfo,
  type OperationsInfoEntry,
  type OperationsInfoKey,
  type OperationsInfoRecord,
} from "@/lib/frontdesk/operations-info";
import {
  DEFAULT_REPLY_TEMPLATES,
  normalizeReplyTemplatesInput,
  type FrontdeskReplyTemplate,
} from "@/lib/frontdesk/reply-templates";

function normalizeEntryArray(value: unknown): OperationsInfoEntry[] {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined) as OperationsInfoEntry[];
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [value as OperationsInfoEntry];
}

function getNestedValue(record: Record<string, unknown>, path: string) {
  const segments = path.split(".");
  let current: unknown = record;

  for (const segment of segments) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function pickFirstValue(record: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    const value = getNestedValue(record, path);
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
}

export async function resolveHotelIdForStaff(params: { uid: string; claimedHotelId?: string }) {
  if (params.claimedHotelId) {
    return params.claimedHotelId;
  }

  const userSnapshot = await getFirebaseAdminDb().collection("users").doc(params.uid).get();
  const profileHotelId = userSnapshot.exists && typeof userSnapshot.data()?.hotel_id === "string"
    ? userSnapshot.data()?.hotel_id
    : "";

  if (!profileHotelId) {
    throw new Error("missing-hotel-id");
  }

  return profileHotelId;
}

export async function getOperationsInfoByHotelId(hotelId: string): Promise<OperationsInfoRecord> {
  const sheetSnapshot = await getFirebaseAdminDb().collection("hearing_sheets").doc(hotelId).get();
  const rawData = sheetSnapshot.data() ?? {};
  const normalized = createEmptyOperationsInfo();

  normalized.frontDeskHours = normalizeEntryArray(
    pickFirstValue(rawData, ["frontDeskHours", "operations.front_desk_hours"]),
  );
  normalized.wifiNetworks = normalizeEntryArray(
    pickFirstValue(rawData, ["wifiNetworks", "wifi.networks"]),
  );
  normalized.breakfastEntries = normalizeEntryArray(
    pickFirstValue(rawData, ["breakfastEntries", "facilities.breakfast_entries"]),
  );
  normalized.bathEntries = normalizeEntryArray(
    pickFirstValue(rawData, ["bathEntries", "facilities.bath_entries"]),
  );
  normalized.facilityEntries = normalizeEntryArray(
    pickFirstValue(rawData, ["facilityEntries", "facilities.entries"]),
  );
  normalized.facilityLocationEntries = normalizeEntryArray(
    pickFirstValue(rawData, ["facilityLocationEntries", "facilities.location_entries"]),
  );
  normalized.amenityEntries = normalizeEntryArray(
    pickFirstValue(rawData, ["amenityEntries", "amenities.entries"]),
  );
  normalized.parkingEntries = normalizeEntryArray(
    pickFirstValue(rawData, ["parkingEntries", "facilities.parking_entries"]),
  );
  normalized.emergencyEntries = normalizeEntryArray(
    pickFirstValue(rawData, ["emergencyEntries", "emergency.entries"]),
  );
  normalized.faqEntries = normalizeEntryArray(
    pickFirstValue(rawData, ["faqEntries", "facilities.faq_entries"]),
  );
  normalized.checkoutEntries = normalizeEntryArray(
    pickFirstValue(rawData, ["checkoutEntries", "checkout.entries"]),
  );
  normalized.roomServiceEntries = normalizeEntryArray(
    pickFirstValue(rawData, ["roomServiceEntries", "room_service.entries"]),
  );
  normalized.transportEntries = normalizeEntryArray(
    pickFirstValue(rawData, ["transportEntries", "transport.entries"]),
  );
  normalized.nearbySpotEntries = normalizeEntryArray(
    pickFirstValue(rawData, ["nearbySpotEntries", "nearby_spots.entries"]),
  );

  return normalized;
}

export async function getReplyTemplatesByHotelId(hotelId: string): Promise<FrontdeskReplyTemplate[]> {
  const sheetSnapshot = await getFirebaseAdminDb().collection("hearing_sheets").doc(hotelId).get();
  const rawData = sheetSnapshot.data() ?? {};

  return normalizeReplyTemplatesInput(
    pickFirstValue(rawData, ["replyTemplates", "reply_templates"]) ?? DEFAULT_REPLY_TEMPLATES,
  );
}

function normalizeEditableEntry(entry: unknown): OperationsInfoEntry | null {
  if (entry === undefined) {
    return null;
  }

  if (entry === null) {
    return null;
  }

  if (typeof entry === "string") {
    const trimmed = entry.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof entry === "number" || typeof entry === "boolean") {
    return entry;
  }

  if (typeof entry === "object" && !Array.isArray(entry)) {
    const normalizedObject = Object.fromEntries(
      Object.entries(entry as Record<string, unknown>).filter(([, value]) => value !== undefined),
    );

    return Object.keys(normalizedObject).length > 0 ? normalizedObject : null;
  }

  return null;
}

export function normalizeOperationsInfoInput(value: unknown): OperationsInfoRecord {
  const normalized = createEmptyOperationsInfo();
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

  for (const key of OPERATIONS_INFO_KEYS) {
    const entries = Array.isArray(record[key]) ? record[key] : [];
    normalized[key] = entries
      .map((entry) => normalizeEditableEntry(entry))
      .filter((entry): entry is OperationsInfoEntry => entry !== null);
  }

  return normalized;
}

export async function saveOperationsInfoByHotelId(params: {
  hotelId: string;
  operationsInfo: OperationsInfoRecord;
  updatedBy: string;
}) {
  const docRef = getFirebaseAdminDb().collection("hearing_sheets").doc(params.hotelId);
  const payload = Object.fromEntries(
    OPERATIONS_INFO_KEYS.map((key: OperationsInfoKey) => [key, params.operationsInfo[key]]),
  );

  await docRef.set(
    {
      ...payload,
      updated_at: new Date().toISOString(),
      updated_by: params.updatedBy,
    },
    { merge: true },
  );
}

export async function saveReplyTemplatesByHotelId(params: {
  hotelId: string;
  replyTemplates: FrontdeskReplyTemplate[];
  updatedBy: string;
}) {
  const docRef = getFirebaseAdminDb().collection("hearing_sheets").doc(params.hotelId);

  await docRef.set(
    {
      replyTemplates: params.replyTemplates,
      updated_at: new Date().toISOString(),
      updated_by: params.updatedBy,
    },
    { merge: true },
  );
}

export { normalizeReplyTemplatesInput };
