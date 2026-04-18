import { NextResponse } from "next/server";
import { verifyFrontdeskApiBearer } from "@/lib/server/frontdesk-api-auth";
import {
  buildFrontdeskGuestPushDispatchKey,
  dispatchFrontdeskGuestMessagePush,
  parsePushDispatchThreadState,
} from "@/lib/server/frontdesk-push";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    verifyFrontdeskApiBearer(request);

    const body = (await request.json().catch(() => ({}))) as Partial<{
      category: string;
      dispatchKey: string;
      hotelId: string;
      lastMessageBody: string;
      lastMessageSender: string;
      messageId: string;
      roomDisplayName: string;
      roomId: string;
      roomNumber: string;
      threadId: string;
      timestamp: string | number;
      unreadCountFront: number;
    }>;

    if (!body.threadId || !body.hotelId) {
      return jsonError("missing-required-fields", 400);
    }

    const dispatchKey =
      body.dispatchKey?.trim() ||
      buildFrontdeskGuestPushDispatchKey({
        messageId: body.messageId,
        threadId: body.threadId,
        timestamp: body.timestamp,
      });

    const result = await dispatchFrontdeskGuestMessagePush({
      dispatchKey,
      hotelId: body.hotelId,
      threadId: body.threadId,
      threadState: parsePushDispatchThreadState(body as Record<string, unknown>),
    });

    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status =
      message === "missing-bearer-token" || message === "invalid-frontdesk-api-token"
        ? 401
        : message === "missing-frontdesk-api-token"
          ? 500
          : message === "cross-hotel-thread"
            ? 403
            : 400;
    console.error("public-frontdesk-push-notifications-route-error", {
      error: message,
      status,
    });

    return jsonError(message, status);
  }
}
