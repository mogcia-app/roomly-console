import { NextResponse } from "next/server";
import { updateCallStatus, type CallUpdateAction } from "@/lib/server/calls";
import { verifyHotelStaffRequest } from "@/lib/server/hotel-auth";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(request: Request, context: RouteContext<"/api/frontdesk/calls/[callId]">) {
  try {
    const staff = await verifyHotelStaffRequest();
    const { callId } = await context.params;
    const body = (await request.json()) as { action?: CallUpdateAction };

    if (!body.action) {
      return jsonError("missing-call-action", 400);
    }

    await updateCallStatus(callId, staff.hotelId, staff.uid, body.action);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status =
      message === "missing-bearer-token"
        ? 401
        : message === "forbidden-role" || message === "forbidden-hotel"
          ? 403
          : 400;

    return jsonError(message, status);
  }
}
