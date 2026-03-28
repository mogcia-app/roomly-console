import { NextResponse } from "next/server";
import { getFirebaseAdminAuth } from "@/lib/server/firebase-admin";
import { syncHotelUserProfile } from "@/lib/server/users";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return jsonError("missing-bearer-token", 401);
    }

    const idToken = authorization.slice("Bearer ".length);
    const decodedToken = await getFirebaseAdminAuth().verifyIdToken(idToken);
    const role = typeof decodedToken.role === "string" ? decodedToken.role : "";
    const hotelId = typeof decodedToken.hotel_id === "string" ? decodedToken.hotel_id : "";

    if (!(role === "hotel_admin" || role === "hotel_front")) {
      return jsonError("forbidden-role", 403);
    }

    if (!hotelId) {
      return jsonError("missing-hotel-id", 400);
    }

    const user = await syncHotelUserProfile({
      uid: decodedToken.uid,
      email: decodedToken.email,
      displayName: decodedToken.name,
      hotelId,
      role,
    });

    return NextResponse.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    return jsonError(message, 400);
  }
}
