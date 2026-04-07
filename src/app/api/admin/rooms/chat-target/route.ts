import { NextResponse } from "next/server";
import { verifyHotelAdminRequest } from "@/lib/server/hotel-auth";
import { resolveActiveRoomChatTarget } from "@/lib/server/stays";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const admin = await verifyHotelAdminRequest();
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get("roomId");

    if (!roomId) {
      return jsonError("missing-room-id", 400);
    }

    const target = await resolveActiveRoomChatTarget({
      hotelId: admin.hotelId,
      roomId,
      adminUid: admin.uid,
    });

    return NextResponse.json(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status =
      message === "forbidden-role"
        ? 403
        : message === "active-stay-not-found"
          ? 404
          : message === "active-stay-conflict"
            ? 409
            : 400;
    return jsonError(message, status);
  }
}
