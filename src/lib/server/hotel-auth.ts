import { headers } from "next/headers";
import { getFirebaseAdminAuth } from "@/lib/server/firebase-admin";

export type VerifiedHotelAdmin = {
  uid: string;
  hotelId: string;
  role: string;
};

async function verifyHotelRequest(options?: { requireHotelId?: boolean }): Promise<VerifiedHotelAdmin> {
  const authorization = (await headers()).get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("missing-bearer-token");
  }

  const idToken = authorization.slice("Bearer ".length);
  const decodedToken = await getFirebaseAdminAuth().verifyIdToken(idToken);
  const role = typeof decodedToken.role === "string" ? decodedToken.role : "";
  const hotelId = typeof decodedToken.hotel_id === "string" ? decodedToken.hotel_id : "";

  if (options?.requireHotelId !== false && !hotelId) {
    throw new Error("missing-hotel-id");
  }

  return {
    uid: decodedToken.uid,
    hotelId,
    role,
  };
}

export async function verifyHotelAdminRequest(): Promise<VerifiedHotelAdmin> {
  const verified = await verifyHotelRequest();

  if (verified.role !== "hotel_admin") {
    throw new Error("forbidden-role");
  }

  return verified;
}

export async function verifyHotelStaffRequest(): Promise<VerifiedHotelAdmin> {
  const verified = await verifyHotelRequest();

  if (verified.role !== "hotel_admin") {
    throw new Error("forbidden-role");
  }

  return verified;
}

export async function verifyHotelStaffIdentity(): Promise<VerifiedHotelAdmin> {
  const verified = await verifyHotelRequest({ requireHotelId: false });

  if (verified.role !== "hotel_admin") {
    throw new Error("forbidden-role");
  }

  return verified;
}
