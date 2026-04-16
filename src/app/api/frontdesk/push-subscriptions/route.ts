import { NextResponse } from "next/server";
import { verifyHotelStaffIdentity } from "@/lib/server/hotel-auth";
import { resolveHotelIdForStaff } from "@/lib/server/hearing-sheets";
import {
  registerFrontdeskPushSubscription,
  unregisterFrontdeskPushSubscription,
} from "@/lib/server/frontdesk-push";

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
    const body = (await request.json().catch(() => ({}))) as Partial<{ token: string; userAgent: string }>;

    if (!body.token) {
      return jsonError("missing-push-token", 400);
    }

    await registerFrontdeskPushSubscription({
      hotelId,
      token: body.token,
      userAgent: body.userAgent,
      userId: identity.uid,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status =
      message === "forbidden-role"
        ? 403
        : message === "missing-bearer-token"
          ? 401
          : 400;
    console.error("frontdesk-push-subscription-register-error", {
      error: message,
      status,
    });
    return jsonError(message, status);
  }
}

export async function DELETE(request: Request) {
  try {
    const identity = await verifyHotelStaffIdentity();
    const hotelId = await resolveHotelIdForStaff({
      uid: identity.uid,
      claimedHotelId: identity.hotelId,
    });
    const body = (await request.json().catch(() => ({}))) as Partial<{ token: string }>;

    if (!body.token) {
      return jsonError("missing-push-token", 400);
    }

    await unregisterFrontdeskPushSubscription({
      hotelId,
      token: body.token,
      userId: identity.uid,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status =
      message === "forbidden-role"
        ? 403
        : message === "missing-bearer-token"
          ? 401
          : 400;
    console.error("frontdesk-push-subscription-delete-error", {
      error: message,
      status,
    });
    return jsonError(message, status);
  }
}
