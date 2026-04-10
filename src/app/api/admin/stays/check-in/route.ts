import { NextResponse } from "next/server";
import { verifyHotelAdminRequest } from "@/lib/server/hotel-auth";
import { createStayCheckIn } from "@/lib/server/stays";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const admin = await verifyHotelAdminRequest();
    const body = (await request.json()) as Partial<{
      roomId: string;
      guestCount: number;
      guestLanguage: string;
      guestName: string;
      reservationId: string;
      notes: string;
      checkInAt: string;
      scheduledCheckOutAt: string;
    }>;

    if (!body.roomId || typeof body.guestCount !== "number") {
      return jsonError("missing-required-fields", 400);
    }

    const stay = await createStayCheckIn({
      hotelId: admin.hotelId,
      roomId: body.roomId,
      guestCount: body.guestCount,
      guestLanguage: body.guestLanguage,
      guestName: body.guestName,
      reservationId: body.reservationId,
      notes: body.notes,
      checkInAt: body.checkInAt,
      scheduledCheckOutAt: body.scheduledCheckOutAt,
      adminUid: admin.uid,
    });

    return NextResponse.json({ stay });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status =
      message === "forbidden-role"
        ? 403
        : message === "active-stay-exists"
          ? 409
        : message === "room-not-found"
          ? 404
          : message === "invalid-check-out-time" || message === "invalid-datetime"
            ? 400
        : 400;
    return jsonError(message, status);
  }
}
