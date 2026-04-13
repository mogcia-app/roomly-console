import { NextResponse } from "next/server";
import { verifyHotelStaffIdentity } from "@/lib/server/hotel-auth";
import {
  getReplyTemplatesByHotelId,
  normalizeReplyTemplatesInput,
  resolveHotelIdForStaff,
  saveReplyTemplatesByHotelId,
} from "@/lib/server/hearing-sheets";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    const identity = await verifyHotelStaffIdentity();
    const hotelId = await resolveHotelIdForStaff({
      uid: identity.uid,
      claimedHotelId: identity.hotelId,
    });
    const replyTemplates = await getReplyTemplatesByHotelId(hotelId);

    return NextResponse.json({
      hotelId,
      replyTemplates,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status = message === "forbidden-role" ? 403 : message === "missing-bearer-token" ? 401 : 400;
    return jsonError(message, status);
  }
}

export async function PATCH(request: Request) {
  try {
    const identity = await verifyHotelStaffIdentity();
    const hotelId = await resolveHotelIdForStaff({
      uid: identity.uid,
      claimedHotelId: identity.hotelId,
    });
    const body = (await request.json()) as Partial<{ replyTemplates: unknown }>;
    const replyTemplates = normalizeReplyTemplatesInput(body.replyTemplates);

    await saveReplyTemplatesByHotelId({
      hotelId,
      replyTemplates,
      updatedBy: identity.uid,
    });

    return NextResponse.json({
      hotelId,
      replyTemplates,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status = message === "forbidden-role" ? 403 : message === "missing-bearer-token" ? 401 : 400;
    return jsonError(message, status);
  }
}
