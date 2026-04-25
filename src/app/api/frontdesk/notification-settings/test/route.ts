import { NextResponse } from "next/server";
import { verifyHotelAdminRequest } from "@/lib/server/hotel-auth";
import { sendFrontdeskNotificationTestEmail } from "@/lib/server/frontdesk-push";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST() {
  try {
    const admin = await verifyHotelAdminRequest();
    const result = await sendFrontdeskNotificationTestEmail({
      hotelId: admin.hotelId,
    });

    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status =
      message === "forbidden-role"
        ? 403
        : message === "missing-bearer-token"
          ? 401
          : 400;
    return jsonError(message, status);
  }
}
