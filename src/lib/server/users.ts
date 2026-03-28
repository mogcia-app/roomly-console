import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdminAuth, getFirebaseAdminDb } from "@/lib/server/firebase-admin";
import type { CreateStaffPayload, HotelUserRecord } from "@/lib/users/types";

function timestampToIso(value: Timestamp | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  return value.toDate().toISOString();
}

function mapUserRecord(
  id: string,
  data: Record<string, unknown>,
  emailFallback?: string,
): HotelUserRecord {
  return {
    id,
    email: typeof data.email === "string" ? data.email : emailFallback ?? "",
    hotel_id: typeof data.hotel_id === "string" ? data.hotel_id : "",
    role: data.role === "hotel_admin" ? "hotel_admin" : "hotel_front",
    display_name: typeof data.display_name === "string" ? data.display_name : "",
    is_active: data.is_active !== false,
    created_at: timestampToIso(data.created_at as Timestamp | string | null | undefined),
    updated_at: timestampToIso(data.updated_at as Timestamp | string | null | undefined),
    disabled_at: timestampToIso(data.disabled_at as Timestamp | string | null | undefined),
    disabled_by: typeof data.disabled_by === "string" ? data.disabled_by : undefined,
    last_sign_in_at:
      typeof data.last_sign_in_at === "string"
        ? data.last_sign_in_at
        : timestampToIso(data.last_sign_in_at as Timestamp | null | undefined) ?? null,
  };
}

export async function listHotelUsers(hotelId: string) {
  const snapshot = await getFirebaseAdminDb()
    .collection("users")
    .where("hotel_id", "==", hotelId)
    .orderBy("created_at", "desc")
    .get();

  return snapshot.docs.map((document) =>
    mapUserRecord(document.id, document.data(), typeof document.data().email === "string" ? document.data().email : ""),
  );
}

export async function createHotelFrontUser(
  hotelId: string,
  createdBy: string,
  payload: CreateStaffPayload,
) {
  const adminAuth = getFirebaseAdminAuth();
  const adminDb = getFirebaseAdminDb();

  const userRecord = await adminAuth.createUser({
    email: payload.email,
    password: payload.password,
    displayName: payload.displayName,
    disabled: false,
  });

  await adminAuth.setCustomUserClaims(userRecord.uid, {
    role: payload.role,
    hotel_id: hotelId,
  });

  const userRef = adminDb.collection("users").doc(userRecord.uid);

  await userRef.set({
    email: payload.email,
    hotel_id: hotelId,
    role: payload.role,
    display_name: payload.displayName,
    is_active: true,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
    created_by: createdBy,
  });

  const createdSnapshot = await userRef.get();
  return mapUserRecord(createdSnapshot.id, createdSnapshot.data() ?? {}, payload.email);
}

export async function updateHotelUserStatus(
  hotelId: string,
  targetUid: string,
  requestedBy: string,
  isActive: boolean,
) {
  const adminAuth = getFirebaseAdminAuth();
  const adminDb = getFirebaseAdminDb();
  const userRef = adminDb.collection("users").doc(targetUid);
  const userSnapshot = await userRef.get();

  if (!userSnapshot.exists) {
    throw new Error("user-not-found");
  }

  const currentData = userSnapshot.data();

  if (!currentData || currentData.hotel_id !== hotelId) {
    throw new Error("cross-hotel-update");
  }

  await adminAuth.updateUser(targetUid, {
    disabled: !isActive,
  });

  await userRef.set(
    {
      is_active: isActive,
      updated_at: FieldValue.serverTimestamp(),
      disabled_at: isActive ? null : FieldValue.serverTimestamp(),
      disabled_by: isActive ? null : requestedBy,
    },
    { merge: true },
  );

  const updatedSnapshot = await userRef.get();
  return mapUserRecord(updatedSnapshot.id, updatedSnapshot.data() ?? {});
}

export async function syncHotelUserProfile(params: {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  hotelId: string;
  role: "hotel_admin" | "hotel_front";
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
  return mapUserRecord(updatedSnapshot.id, updatedSnapshot.data() ?? {}, params.email ?? undefined);
}
