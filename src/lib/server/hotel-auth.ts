import { headers } from "next/headers";
import { getFirebaseAdminAuth } from "@/lib/server/firebase-admin";

export type VerifiedHotelAdmin = {
  uid: string;
  hotelId: string;
  role: string;
};

export async function verifyHotelAdminRequest(): Promise<VerifiedHotelAdmin> {
  const authorization = (await headers()).get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("missing-bearer-token");
  }

  const idToken = authorization.slice("Bearer ".length);
  const decodedToken = await getFirebaseAdminAuth().verifyIdToken(idToken);
  const role = typeof decodedToken.role === "string" ? decodedToken.role : "";
  const hotelId = typeof decodedToken.hotel_id === "string" ? decodedToken.hotel_id : "";

  if (role !== "hotel_admin") {
    throw new Error("forbidden-role");
  }

  if (!hotelId) {
    throw new Error("missing-hotel-id");
  }

  return {
    uid: decodedToken.uid,
    hotelId,
    role,
  };
}
