import { NextResponse } from "next/server";
import { verifyFrontdeskApiBearer } from "@/lib/server/frontdesk-api-auth";
import { listSupportedGuestLanguages } from "@/lib/server/guest-language";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    verifyFrontdeskApiBearer(request);

    return NextResponse.json({
      guestLanguages: listSupportedGuestLanguages(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status =
      message === "missing-bearer-token" || message === "invalid-frontdesk-api-token"
        ? 401
        : message === "missing-frontdesk-api-token"
          ? 500
          : 400;
    return jsonError(message, status);
  }
}
