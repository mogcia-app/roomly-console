import { NextResponse } from "next/server";
import { verifyHotelStaffIdentity } from "@/lib/server/hotel-auth";
import { getOperationsInfoByHotelId, resolveHotelIdForStaff } from "@/lib/server/hearing-sheets";

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
    const operationsInfo = await getOperationsInfoByHotelId(hotelId);

    return NextResponse.json({
      hotelId,
      operationsInfo,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status =
      message === "forbidden-role" ? 403 : message === "missing-bearer-token" ? 401 : 400;
    return jsonError(message, status);
  }
}
