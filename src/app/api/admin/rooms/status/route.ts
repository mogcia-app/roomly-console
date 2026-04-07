import { NextResponse } from "next/server";
import { verifyHotelAdminRequest } from "@/lib/server/hotel-auth";
import { listHotelRoomStatuses } from "@/lib/server/stays";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    const admin = await verifyHotelAdminRequest();
    const rooms = await listHotelRoomStatuses(admin.hotelId, admin.uid);
    return NextResponse.json({ rooms });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status = message === "forbidden-role" ? 403 : 401;
    return jsonError(message, status);
  }
}
