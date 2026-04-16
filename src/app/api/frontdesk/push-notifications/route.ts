import { NextResponse } from "next/server";
import { verifyHotelStaffIdentity } from "@/lib/server/hotel-auth";
import { resolveHotelIdForStaff } from "@/lib/server/hearing-sheets";
import { dispatchFrontdeskGuestMessagePush } from "@/lib/server/frontdesk-push";

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
    const body = (await request.json().catch(() => ({}))) as Partial<{ dispatchKey: string; threadId: string }>;

    if (!body.threadId || !body.dispatchKey) {
      return jsonError("missing-required-fields", 400);
    }

    const result = await dispatchFrontdeskGuestMessagePush({
      dispatchKey: body.dispatchKey,
      hotelId,
      threadId: body.threadId,
    });

    return NextResponse.json({ result });
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
    console.error("frontdesk-push-notifications-route-error", {
      error: message,
      status,
    });
    return jsonError(message, status);
  }
}
