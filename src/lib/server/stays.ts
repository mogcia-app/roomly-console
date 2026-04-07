import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { RoomStatusRecord, StayRecord, StayStatus } from "@/lib/frontdesk/types";
import { listHotelRooms } from "@/lib/server/rooms";
import { getFirebaseAdminDb } from "@/lib/server/firebase-admin";

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readTimestamp(value: unknown): StayRecord["check_in_at"] {
  return value && typeof value === "object" && "toDate" in value ? (value as StayRecord["check_in_at"]) : null;
}

function parseOptionalIsoDate(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("invalid-datetime");
  }

  return Timestamp.fromDate(parsed);
}

function normalizeStayStatus(value: unknown): StayStatus {
  return value === "checked_out" || value === "cancelled" ? value : "active";
}

function mapStayRecord(document: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>): StayRecord {
  const data = document.data() ?? {};
  const status = normalizeStayStatus(data.status);
  const isActive = readBoolean(data.is_active) ?? readBoolean(data.isActive) ?? status === "active";

  return {
    id: document.id,
    hotel_id: readString(data.hotel_id) || readString(data.hotelId),
    room_id: readString(data.room_id) || readString(data.roomId),
    is_active: isActive,
    status,
    check_in_at: readTimestamp(data.check_in_at) ?? readTimestamp(data.checkInAt) ?? readTimestamp(data.check_in),
    check_out_at: readTimestamp(data.check_out_at) ?? readTimestamp(data.checkOutAt),
    scheduled_check_in_at:
      readTimestamp(data.scheduled_check_in_at) ?? readTimestamp(data.scheduledCheckInAt),
    scheduled_check_out_at:
      readTimestamp(data.scheduled_check_out_at) ?? readTimestamp(data.scheduledCheckOutAt),
    auto_checked_out_at:
      readTimestamp(data.auto_checked_out_at) ?? readTimestamp(data.autoCheckedOutAt),
    check_out_mode:
      data.check_out_mode === "manual" || data.check_out_mode === "automatic"
        ? data.check_out_mode
        : data.checkOutMode === "manual" || data.checkOutMode === "automatic"
          ? data.checkOutMode
          : null,
    created_at: readTimestamp(data.created_at) ?? readTimestamp(data.createdAt),
    updated_at: readTimestamp(data.updated_at) ?? readTimestamp(data.updatedAt),
    guest_name: readNullableString(data.guest_name) ?? readNullableString(data.guestName),
    guest_count: readNumber(data.guest_count) ?? readNumber(data.guestCount),
    reservation_id: readNullableString(data.reservation_id) ?? readNullableString(data.reservationId),
    checked_in_by: readNullableString(data.checked_in_by) ?? readNullableString(data.checkedInBy),
    checked_out_by: readNullableString(data.checked_out_by) ?? readNullableString(data.checkedOutBy),
    notes: readNullableString(data.notes),
  };
}

function uniqById<T extends { id: string }>(items: T[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function logStayEvent(
  event: string,
  params: {
    roomId: string;
    hotelId: string;
    stayId?: string | null;
    adminUid: string;
    extra?: Record<string, unknown>;
  },
) {
  console.warn(
    `[stays] ${event}`,
    JSON.stringify({
      roomId: params.roomId,
      hotelId: params.hotelId,
      stayId: params.stayId ?? null,
      adminUid: params.adminUid,
      ...(params.extra ?? {}),
    }),
  );
}

async function listStaysByHotelField(field: "hotel_id" | "hotelId", hotelId: string) {
  const snapshot = await getFirebaseAdminDb().collection("stays").where(field, "==", hotelId).get();
  return snapshot.docs.map(mapStayRecord);
}

export async function listHotelStays(hotelId: string) {
  const [snakeCase, camelCase] = await Promise.all([
    listStaysByHotelField("hotel_id", hotelId),
    listStaysByHotelField("hotelId", hotelId),
  ]);

  return uniqById([...snakeCase, ...camelCase]);
}

async function autoCheckOutExpiredStays(hotelId: string, adminUid: string) {
  const now = Date.now();
  const activeStays = (await listHotelStays(hotelId)).filter((stay) => stay.is_active);
  const expired = activeStays.filter((stay) => {
    const scheduledCheckOut = stay.scheduled_check_out_at?.toDate().getTime();
    return typeof scheduledCheckOut === "number" && scheduledCheckOut <= now;
  });

  if (!expired.length) {
    return [];
  }

  const adminDb = getFirebaseAdminDb();
  await Promise.all(
    expired.map(async (stay) => {
      await adminDb.collection("stays").doc(stay.id).set(
        {
          is_active: false,
          isActive: false,
          status: "checked_out",
          check_out_at: FieldValue.serverTimestamp(),
          checkOutAt: FieldValue.serverTimestamp(),
          auto_checked_out_at: FieldValue.serverTimestamp(),
          autoCheckedOutAt: FieldValue.serverTimestamp(),
          check_out_mode: "automatic",
          checkOutMode: "automatic",
          checked_out_by: "system:auto-checkout",
          checkedOutBy: "system:auto-checkout",
          updated_at: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      logStayEvent("auto-check-out-executed", {
        roomId: stay.room_id,
        hotelId,
        stayId: stay.id,
        adminUid,
        extra: {
          scheduledCheckOutAt: stay.scheduled_check_out_at?.toDate().toISOString() ?? null,
        },
      });
    }),
  );

  return expired.map((stay) => stay.id);
}

export async function listHotelActiveStays(hotelId: string) {
  await autoCheckOutExpiredStays(hotelId, "system:auto-checkout");
  const stays = await listHotelStays(hotelId);
  return stays.filter((stay) => stay.is_active);
}

async function assertRoomBelongsToHotel(hotelId: string, roomId: string) {
  const roomSnapshot = await getFirebaseAdminDb().collection("rooms").doc(roomId).get();

  if (!roomSnapshot.exists) {
    throw new Error("room-not-found");
  }

  const roomData = roomSnapshot.data();
  const roomHotelId = readString(roomData?.hotel_id) || readString(roomData?.hotelId);

  if (roomHotelId !== hotelId) {
    throw new Error("cross-hotel-room");
  }

  return roomSnapshot;
}

export async function listHotelRoomStatuses(hotelId: string, adminUid: string) {
  await autoCheckOutExpiredStays(hotelId, adminUid);
  const [rooms, activeStays] = await Promise.all([listHotelRooms(hotelId), listHotelActiveStays(hotelId)]);
  const activeStaysByRoom = new Map<string, StayRecord[]>();

  for (const stay of activeStays) {
    const current = activeStaysByRoom.get(stay.room_id) ?? [];
    current.push(stay);
    activeStaysByRoom.set(stay.room_id, current);
  }

  return rooms.map<RoomStatusRecord>((room) => {
    const roomId = room.room_id || room.id;
    const roomActiveStays = activeStaysByRoom.get(roomId) ?? [];

    if (roomActiveStays.length > 1) {
      logStayEvent("multiple-active-stays", {
        roomId,
        hotelId,
        adminUid,
        stayId: null,
        extra: { stayIds: roomActiveStays.map((stay) => stay.id) },
      });
    }

    return {
      room,
      status: roomActiveStays.length === 0 ? "vacant" : roomActiveStays.length === 1 ? "occupied" : "conflict",
      active_stays: roomActiveStays,
      active_stay: roomActiveStays.length === 1 ? roomActiveStays[0] : null,
    };
  });
}

export async function createStayCheckIn(params: {
  hotelId: string;
  roomId: string;
  guestCount: number;
  adminUid: string;
  guestName?: string;
  reservationId?: string;
  notes?: string;
  checkInAt?: string;
  scheduledCheckOutAt?: string;
}) {
  if (!Number.isInteger(params.guestCount) || params.guestCount <= 0) {
    throw new Error("invalid-guest-count");
  }

  await assertRoomBelongsToHotel(params.hotelId, params.roomId);

  const activeStays = (await listHotelActiveStays(params.hotelId)).filter((stay) => stay.room_id === params.roomId);

  if (activeStays.length > 0) {
    logStayEvent("check-in-active-stay-exists", {
      roomId: params.roomId,
      hotelId: params.hotelId,
      stayId: activeStays[0]?.id ?? null,
      adminUid: params.adminUid,
      extra: { stayIds: activeStays.map((stay) => stay.id) },
    });
    throw new Error("active-stay-exists");
  }

  const stayRef = getFirebaseAdminDb().collection("stays").doc();
  const guestName = readNullableString(params.guestName);
  const reservationId = readNullableString(params.reservationId);
  const notes = readNullableString(params.notes);
  const checkInAt = parseOptionalIsoDate(params.checkInAt);
  const scheduledCheckOutAt = parseOptionalIsoDate(params.scheduledCheckOutAt);

  if (checkInAt && scheduledCheckOutAt && scheduledCheckOutAt.toDate().getTime() <= checkInAt.toDate().getTime()) {
    throw new Error("invalid-check-out-time");
  }

  await stayRef.set({
    hotel_id: params.hotelId,
    hotelId: params.hotelId,
    room_id: params.roomId,
    roomId: params.roomId,
    is_active: true,
    isActive: true,
    status: "active",
    check_in_at: checkInAt ?? FieldValue.serverTimestamp(),
    checkInAt: checkInAt ?? FieldValue.serverTimestamp(),
    check_out_at: null,
    checkOutAt: null,
    scheduled_check_in_at: checkInAt ?? null,
    scheduledCheckInAt: checkInAt ?? null,
    scheduled_check_out_at: scheduledCheckOutAt ?? null,
    scheduledCheckOutAt: scheduledCheckOutAt ?? null,
    auto_checked_out_at: null,
    autoCheckedOutAt: null,
    check_out_mode: null,
    checkOutMode: null,
    guest_count: params.guestCount,
    guestCount: params.guestCount,
    guest_name: guestName,
    guestName: guestName,
    reservation_id: reservationId,
    reservationId: reservationId,
    checked_in_by: params.adminUid,
    checkedInBy: params.adminUid,
    checked_out_by: null,
    checkedOutBy: null,
    notes,
    created_at: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const snapshot = await stayRef.get();
  return mapStayRecord(snapshot);
}

function requireSingleActiveStay(
  activeStays: StayRecord[],
  params: { hotelId: string; roomId: string; adminUid: string; noActiveEvent: string; multiActiveEvent: string },
) {
  if (activeStays.length === 0) {
    logStayEvent(params.noActiveEvent, {
      roomId: params.roomId,
      hotelId: params.hotelId,
      stayId: null,
      adminUid: params.adminUid,
    });
    throw new Error("active-stay-not-found");
  }

  if (activeStays.length > 1) {
    logStayEvent(params.multiActiveEvent, {
      roomId: params.roomId,
      hotelId: params.hotelId,
      stayId: null,
      adminUid: params.adminUid,
      extra: { stayIds: activeStays.map((stay) => stay.id) },
    });
    throw new Error("active-stay-conflict");
  }

  return activeStays[0];
}

export async function checkOutStay(params: { hotelId: string; roomId: string; adminUid: string }) {
  await assertRoomBelongsToHotel(params.hotelId, params.roomId);
  await autoCheckOutExpiredStays(params.hotelId, params.adminUid);

  const activeStay = requireSingleActiveStay(
    (await listHotelActiveStays(params.hotelId)).filter((stay) => stay.room_id === params.roomId),
    {
      hotelId: params.hotelId,
      roomId: params.roomId,
      adminUid: params.adminUid,
      noActiveEvent: "check-out-active-stay-not-found",
      multiActiveEvent: "check-out-active-stay-conflict",
    },
  );

  const stayRef = getFirebaseAdminDb().collection("stays").doc(activeStay.id);
  await stayRef.set(
    {
      is_active: false,
      isActive: false,
      status: "checked_out",
      check_out_at: FieldValue.serverTimestamp(),
      checkOutAt: FieldValue.serverTimestamp(),
      checked_out_by: params.adminUid,
      checkedOutBy: params.adminUid,
      check_out_mode: "manual",
      checkOutMode: "manual",
      updated_at: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const snapshot = await stayRef.get();
  return mapStayRecord(snapshot);
}

async function listThreadsByStayIdField(field: "stay_id" | "stayId", stayId: string) {
  const snapshot = await getFirebaseAdminDb().collection("chat_threads").where(field, "==", stayId).get();
  return snapshot.docs.map((document) => ({
    id: document.id,
    data: document.data(),
  }));
}

export async function resolveActiveRoomChatTarget(params: { hotelId: string; roomId: string; adminUid: string }) {
  await assertRoomBelongsToHotel(params.hotelId, params.roomId);
  await autoCheckOutExpiredStays(params.hotelId, params.adminUid);

  const activeStay = requireSingleActiveStay(
    (await listHotelActiveStays(params.hotelId)).filter((stay) => stay.room_id === params.roomId),
    {
      hotelId: params.hotelId,
      roomId: params.roomId,
      adminUid: params.adminUid,
      noActiveEvent: "chat-open-active-stay-not-found",
      multiActiveEvent: "chat-open-active-stay-conflict",
    },
  );

  const [snakeCaseThreads, camelCaseThreads] = await Promise.all([
    listThreadsByStayIdField("stay_id", activeStay.id),
    listThreadsByStayIdField("stayId", activeStay.id),
  ]);

  const threads = uniqById(
    [...snakeCaseThreads, ...camelCaseThreads].map((thread) => ({
      id: thread.id,
      updatedAt: readTimestamp(thread.data.updated_at) ?? readTimestamp(thread.data.updatedAt),
      mode: readString(thread.data.mode),
    })),
  ).filter((thread) => thread.mode === "human");

  threads.sort((left, right) => (right.updatedAt?.toDate().getTime() ?? 0) - (left.updatedAt?.toDate().getTime() ?? 0));

  return {
    stayId: activeStay.id,
    threadId: threads[0]?.id ?? null,
  };
}
