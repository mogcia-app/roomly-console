export const OPERATIONS_INFO_KEYS = [
  "frontDeskHours",
  "wifiNetworks",
  "breakfastEntries",
  "bathEntries",
  "facilityEntries",
  "facilityLocationEntries",
  "amenityEntries",
  "parkingEntries",
  "emergencyEntries",
  "faqEntries",
  "checkoutEntries",
  "roomServiceEntries",
  "transportEntries",
  "nearbySpotEntries",
] as const;

export type OperationsInfoKey = (typeof OPERATIONS_INFO_KEYS)[number];

export type OperationsInfoEntry = Record<string, unknown> | string | number | boolean | null;

export type OperationsInfoRecord = Record<OperationsInfoKey, OperationsInfoEntry[]>;

export function createEmptyOperationsInfo(): OperationsInfoRecord {
  return {
    frontDeskHours: [],
    wifiNetworks: [],
    breakfastEntries: [],
    bathEntries: [],
    facilityEntries: [],
    facilityLocationEntries: [],
    amenityEntries: [],
    parkingEntries: [],
    emergencyEntries: [],
    faqEntries: [],
    checkoutEntries: [],
    roomServiceEntries: [],
    transportEntries: [],
    nearbySpotEntries: [],
  };
}

