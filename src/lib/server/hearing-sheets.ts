import { getFirebaseAdminDb } from "@/lib/server/firebase-admin";
import {
  createEmptyOperationsInfo,
  type OperationsInfoEntry,
  type OperationsInfoRecord,
} from "@/lib/frontdesk/operations-info";

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
