import { NextResponse } from "next/server";
import { resolveHotelIdForStaff } from "@/lib/server/hearing-sheets";
import { verifyHotelAdminRequest, verifyHotelStaffIdentity } from "@/lib/server/hotel-auth";
import {
  getHotelNotificationSettings,
  parseNotificationEmailsInput,
  updateHotelNotificationSettings,
} from "@/lib/server/hotel-notification-settings";

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
    const settings = await getHotelNotificationSettings(hotelId);

    return NextResponse.json({
      notificationEmails: settings.notificationEmails,
      usesFallbackRecipients: settings.notificationEmails.length === 0,
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

export async function PATCH(request: Request) {
  try {
    const admin = await verifyHotelAdminRequest();
    const body = (await request.json().catch(() => ({}))) as Partial<{
      notificationEmails: unknown;
    }>;
    const { invalidEntries, notificationEmails } = parseNotificationEmailsInput(body.notificationEmails);

    if (invalidEntries.length > 0) {
      return jsonError("invalid-notification-email", 400);
    }

    const settings = await updateHotelNotificationSettings({
      hotelId: admin.hotelId,
      notificationEmails,
      updatedBy: admin.uid,
    });

    return NextResponse.json({
      notificationEmails: settings.notificationEmails,
      usesFallbackRecipients: settings.notificationEmails.length === 0,
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
