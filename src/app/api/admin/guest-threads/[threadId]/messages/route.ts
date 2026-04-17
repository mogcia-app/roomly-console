import { NextResponse } from "next/server";
import { saveFrontDeskMessage } from "@/lib/server/frontdesk-messages";
import { getFirebaseAdminDb } from "@/lib/server/firebase-admin";
import { verifyFrontdeskApiBearer } from "@/lib/server/frontdesk-api-auth";

type SupportedTranslationKey = "en" | "zh-CN" | "zh-TW" | "ko" | "ja";

type RequestBody = Partial<{
  body: string;
  imageUrl: string;
  imageAlt: string;
  translations: Partial<Record<SupportedTranslationKey, string>>;
}>;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function resolveHotelIdForThread(threadId: string) {
  const snapshot = await getFirebaseAdminDb().collection("chat_threads").doc(threadId).get();

  if (!snapshot.exists) {
    throw new Error("thread-not-found");
  }

  const hotelId = snapshot.data()?.hotel_id;

  if (typeof hotelId !== "string" || !hotelId.trim()) {
    throw new Error("missing-hotel-id");
  }

  return hotelId.trim();
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/admin/guest-threads/[threadId]/messages">,
) {
  try {
    verifyFrontdeskApiBearer(request);

    const { threadId } = await context.params;
    const body = (await request.json()) as RequestBody;

    if (!threadId || !body.body?.trim()) {
      return jsonError("missing-required-fields", 400);
    }

    const hotelId = await resolveHotelIdForThread(threadId);
    const message = await saveFrontDeskMessage({
      threadId,
      hotelId,
      body: body.body,
      imageUrl: body.imageUrl,
      imageAlt: body.imageAlt,
      translations: body.translations,
    });

    return NextResponse.json({ message }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status =
      message === "missing-bearer-token" || message === "invalid-frontdesk-api-token"
        ? 401
        : message === "thread-not-found"
          ? 404
          : message === "missing-frontdesk-api-token"
            ? 500
            : message === "unsupported-thread-mode" ||
                message === "thread-resolved" ||
                message === "thread-assigned" ||
                message === "cross-hotel-thread" ||
                message === "missing-hotel-id"
              ? 409
              : message === "empty-message"
                ? 400
                : 500;

    return jsonError(message, status);
  }
}
