import { NextResponse } from "next/server";
import { verifyHotelStaffIdentity } from "@/lib/server/hotel-auth";
import { saveFrontDeskMessage } from "@/lib/server/frontdesk-messages";
import { resolveHotelIdForStaff } from "@/lib/server/hearing-sheets";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const identity = await verifyHotelStaffIdentity();
    const hotelId = await resolveHotelIdForStaff({
      uid: identity.uid,
      claimedHotelId: identity.hotelId,
    });
    const body = (await request.json()) as Partial<{ threadId: string; body: string }>;

    if (!body.threadId || !body.body) {
      return jsonError("missing-required-fields", 400);
    }

    const message = await saveFrontDeskMessage({
      threadId: body.threadId,
      hotelId,
      staffUserId: identity.uid,
      body: body.body,
    });

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status =
      message === "forbidden-role"
        ? 403
        : message === "missing-bearer-token"
          ? 401
          : message === "cross-hotel-thread"
            ? 403
            : 400;
    return jsonError(message, status);
  }
}
