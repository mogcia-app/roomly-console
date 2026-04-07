import { NextResponse } from "next/server";
import { verifyHotelAdminRequest } from "@/lib/server/hotel-auth";
import { checkOutStay } from "@/lib/server/stays";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const admin = await verifyHotelAdminRequest();
    const body = (await request.json()) as Partial<{ roomId: string }>;

    if (!body.roomId) {
      return jsonError("missing-room-id", 400);
    }

    const stay = await checkOutStay({
      hotelId: admin.hotelId,
      roomId: body.roomId,
      adminUid: admin.uid,
    });

    return NextResponse.json({ stay });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status =
      message === "forbidden-role"
        ? 403
        : message === "active-stay-not-found"
          ? 404
          : message === "active-stay-conflict"
            ? 409
            : message === "room-not-found"
              ? 404
              : 400;
    return jsonError(message, status);
  }
}
