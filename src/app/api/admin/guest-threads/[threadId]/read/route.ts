import { NextResponse } from "next/server";
import { verifyHotelStaffIdentity } from "@/lib/server/hotel-auth";
import { markGuestThreadMessagesRead } from "@/lib/server/guest-thread-reads";
import { resolveHotelIdForStaff } from "@/lib/server/hearing-sheets";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  try {
    const identity = await verifyHotelStaffIdentity();
    const hotelId = await resolveHotelIdForStaff({
      uid: identity.uid,
      claimedHotelId: identity.hotelId,
    });
    const { threadId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as Partial<{ messageIds: unknown }>;
    const messageIds = Array.isArray(body.messageIds)
      ? body.messageIds.filter((messageId): messageId is string => typeof messageId === "string")
      : undefined;

    if (!threadId) {
      return jsonError("missing-thread-id", 400);
    }

    const result = await markGuestThreadMessagesRead({
      hotelId,
      threadId,
      messageIds,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status =
      message === "forbidden-role"
        ? 403
        : message === "missing-bearer-token"
          ? 401
          : message === "thread-not-found"
            ? 404
            : message === "cross-hotel-thread"
              ? 403
              : 400;
    return jsonError(message, status);
  }
}
