import { NextResponse } from "next/server";
import { verifyHotelAdminRequest } from "@/lib/server/hotel-auth";
import { updateHotelUserStatus } from "@/lib/server/users";
import type { UpdateStaffStatusPayload } from "@/lib/users/types";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  try {
    const admin = await verifyHotelAdminRequest();
    const body = (await request.json()) as Partial<UpdateStaffStatusPayload>;
    const { uid } = await params;

    if (typeof body.isActive !== "boolean") {
      return jsonError("invalid-isActive", 400);
    }

    const user = await updateHotelUserStatus(admin.hotelId, uid, admin.uid, body.isActive);
    return NextResponse.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status = message === "forbidden-role" ? 403 : 400;
    return jsonError(message, status);
  }
}
