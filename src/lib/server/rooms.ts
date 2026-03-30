import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb } from "@/lib/server/firebase-admin";
import type { RoomRecord } from "@/lib/frontdesk/types";

function mapRoomRecord(id: string, data: Record<string, unknown>): RoomRecord {
  return {
    id,
    room_id: typeof data.room_id === "string" ? data.room_id : id,
    hotel_id: typeof data.hotel_id === "string" ? data.hotel_id : "",
    room_number: typeof data.room_number === "string" ? data.room_number : "",
    display_name: typeof data.display_name === "string" ? data.display_name : null,
    floor: typeof data.floor === "string" ? data.floor : null,
    room_type: typeof data.room_type === "string" ? data.room_type : null,
    updated_at: (data.updated_at as RoomRecord["updated_at"]) ?? null,
  };
}

export async function listHotelRooms(hotelId: string) {
  const snapshot = await getFirebaseAdminDb()
    .collection("rooms")
    .where("hotel_id", "==", hotelId)
    .orderBy("room_number", "asc")
    .get();

  return snapshot.docs.map((document) => mapRoomRecord(document.id, document.data()));
}

export async function updateHotelRoomDisplayName(hotelId: string, roomId: string, displayName: string | null) {
  const roomRef = getFirebaseAdminDb().collection("rooms").doc(roomId);
  const roomSnapshot = await roomRef.get();

  if (!roomSnapshot.exists) {
    throw new Error("room-not-found");
  }

  const roomData = roomSnapshot.data();

  if (!roomData || roomData.hotel_id !== hotelId) {
    throw new Error("cross-hotel-update");
  }

  const normalizedDisplayName = displayName?.trim() ? displayName.trim() : null;

  await roomRef.set(
    {
      display_name: normalizedDisplayName,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const updatedSnapshot = await roomRef.get();
  return mapRoomRecord(updatedSnapshot.id, updatedSnapshot.data() ?? {});
}
