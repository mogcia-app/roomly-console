import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdminAuth, getFirebaseAdminDb } from "@/lib/server/firebase-admin";

export async function syncHotelUserProfile(params: {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  hotelId: string;
  role: "hotel_admin";
}) {
  const adminDb = getFirebaseAdminDb();
  const userRef = adminDb.collection("users").doc(params.uid);
  const existingSnapshot = await userRef.get();

  await userRef.set(
    {
      email: params.email ?? existingSnapshot.data()?.email ?? "",
      hotel_id: params.hotelId,
      role: params.role,
      display_name: params.displayName ?? existingSnapshot.data()?.display_name ?? "",
      is_active: existingSnapshot.exists ? existingSnapshot.data()?.is_active !== false : true,
      updated_at: FieldValue.serverTimestamp(),
      last_sign_in_at: new Date().toISOString(),
      ...(existingSnapshot.exists ? {} : { created_at: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );

  const updatedSnapshot = await userRef.get();
  const data = updatedSnapshot.data() ?? {};

  return {
    id: updatedSnapshot.id,
    email: typeof data.email === "string" ? data.email : params.email ?? "",
    hotel_id: typeof data.hotel_id === "string" ? data.hotel_id : params.hotelId,
    role: "hotel_admin" as const,
    display_name: typeof data.display_name === "string" ? data.display_name : params.displayName ?? "",
    is_active: data.is_active !== false,
    created_at:
      data.created_at instanceof Timestamp
        ? data.created_at.toDate().toISOString()
        : typeof data.created_at === "string"
          ? data.created_at
          : undefined,
    updated_at:
      data.updated_at instanceof Timestamp
        ? data.updated_at.toDate().toISOString()
        : typeof data.updated_at === "string"
          ? data.updated_at
          : undefined,
    disabled_at:
      data.disabled_at instanceof Timestamp
        ? data.disabled_at.toDate().toISOString()
        : typeof data.disabled_at === "string"
          ? data.disabled_at
          : undefined,
    disabled_by: typeof data.disabled_by === "string" ? data.disabled_by : undefined,
    last_sign_in_at: typeof data.last_sign_in_at === "string" ? data.last_sign_in_at : null,
  };
}
