import { NextResponse } from "next/server";
import { createHotelFrontUser, listHotelUsers } from "@/lib/server/users";
import { verifyHotelAdminRequest } from "@/lib/server/hotel-auth";
import type { CreateStaffPayload } from "@/lib/users/types";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    const admin = await verifyHotelAdminRequest();
    const users = await listHotelUsers(admin.hotelId);
    return NextResponse.json({ users });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status = message === "forbidden-role" ? 403 : 401;
    return jsonError(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await verifyHotelAdminRequest();
    const body = (await request.json()) as Partial<CreateStaffPayload>;

    if (!body.email || !body.password || !body.displayName) {
      return jsonError("missing-required-fields", 400);
    }

    const user = await createHotelFrontUser(admin.hotelId, admin.uid, {
      displayName: body.displayName,
      email: body.email,
      password: body.password,
      role: "hotel_front",
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status = message === "forbidden-role" ? 403 : 400;
    return jsonError(message, status);
  }
}
