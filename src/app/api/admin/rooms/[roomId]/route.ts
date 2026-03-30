import { NextResponse } from "next/server";
import { verifyHotelAdminRequest } from "@/lib/server/hotel-auth";
import { updateHotelRoomDisplayName } from "@/lib/server/rooms";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const admin = await verifyHotelAdminRequest();
    const body = (await request.json()) as { displayName?: string | null };
    const { roomId } = await params;

    if (!("displayName" in body) || (body.displayName !== null && typeof body.displayName !== "string")) {
      return jsonError("invalid-display-name", 400);
    }

    const room = await updateHotelRoomDisplayName(admin.hotelId, roomId, body.displayName ?? null);
    return NextResponse.json({ room });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status = message === "forbidden-role" ? 403 : 400;
    return jsonError(message, status);
  }
}
