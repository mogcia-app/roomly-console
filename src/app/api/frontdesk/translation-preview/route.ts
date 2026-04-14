import { NextResponse } from "next/server";
import { verifyHotelStaffIdentity } from "@/lib/server/hotel-auth";
import { translateText } from "@/lib/server/frontdesk-translation";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    await verifyHotelStaffIdentity();

    const body = (await request.json()) as Partial<{
      text: string;
      sourceLanguage: string;
      targetLanguage: string;
    }>;
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!text) {
      return jsonError("missing-text", 400);
    }

    const translation = await translateText({
      sourceLanguage: typeof body.sourceLanguage === "string" ? body.sourceLanguage : "",
      targetLanguage: typeof body.targetLanguage === "string" ? body.targetLanguage : "ja",
      text,
    });

    return NextResponse.json({
      translatedText: translation.text,
      translationState: translation.state,
      sourceLanguage: translation.sourceLanguage,
      targetLanguage: translation.targetLanguage,
    });
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
