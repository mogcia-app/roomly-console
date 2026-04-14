import { NextResponse } from "next/server";
import { verifyFrontdeskApiBearer } from "@/lib/server/frontdesk-api-auth";
import { updateGuestLanguageForThread } from "@/lib/server/guest-language";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  try {
    verifyFrontdeskApiBearer(request);
    const { threadId } = await context.params;
    const body = (await request.json()) as Partial<{
      guestLanguage: string;
      retranslateHistory: boolean;
    }>;

    if (!threadId) {
      return jsonError("missing-thread-id", 400);
    }

    if (!body.guestLanguage || typeof body.guestLanguage !== "string") {
      return jsonError("missing-guest-language", 400);
    }

    const result = await updateGuestLanguageForThread({
      threadId,
      guestLanguage: body.guestLanguage,
      retranslateHistory: body.retranslateHistory !== false,
    });

    return NextResponse.json({ thread: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status =
      message === "missing-bearer-token" || message === "invalid-frontdesk-api-token"
          ? 401
          : message === "missing-frontdesk-api-token"
            ? 500
          : message === "thread-not-found"
            ? 404
            : message === "cross-hotel-thread"
              ? 403
              : 400;
    return jsonError(message, status);
  }
}
