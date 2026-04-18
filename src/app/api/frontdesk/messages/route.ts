import { NextResponse } from "next/server";
import { verifyHotelStaffIdentity } from "@/lib/server/hotel-auth";
import { getFirebaseAdminDb } from "@/lib/server/firebase-admin";
import { saveFrontDeskMessage } from "@/lib/server/frontdesk-messages";
import { resolveHotelIdForStaff } from "@/lib/server/hearing-sheets";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function uniqueById<T extends { id: string }>(items: T[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function mapMessageSnapshot(
  snapshot: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>,
) {
  return {
    id: snapshot.id,
    ...(snapshot.data() as Record<string, unknown>),
  };
}

async function assertThreadBelongsToHotel(threadId: string, hotelId: string) {
  const snapshot = await getFirebaseAdminDb().collection("chat_threads").doc(threadId).get();

  if (!snapshot.exists) {
    throw new Error("thread-not-found");
  }

  const data = snapshot.data() ?? {};
  const threadHotelId = readString(data.hotel_id) || readString(data.hotelId);

  if (!threadHotelId || threadHotelId !== hotelId) {
    throw new Error("cross-hotel-thread");
  }
}

async function assertStayBelongsToHotel(stayId: string, hotelId: string) {
  const snapshot = await getFirebaseAdminDb().collection("stays").doc(stayId).get();

  if (!snapshot.exists) {
    throw new Error("stay-not-found");
  }

  const data = snapshot.data() ?? {};
  const stayHotelId = readString(data.hotel_id) || readString(data.hotelId);

  if (!stayHotelId || stayHotelId !== hotelId) {
    throw new Error("cross-hotel-stay");
  }
}

export async function GET(request: Request) {
  try {
    const identity = await verifyHotelStaffIdentity();
    const hotelId = await resolveHotelIdForStaff({
      uid: identity.uid,
      claimedHotelId: identity.hotelId,
    });
    const url = new URL(request.url);
    const threadId = url.searchParams.get("threadId")?.trim() ?? "";
    const stayId = url.searchParams.get("stayId")?.trim() ?? "";

    if (!threadId && !stayId) {
      return jsonError("missing-required-fields", 400);
    }

    if (threadId) {
      await assertThreadBelongsToHotel(threadId, hotelId);

      const [snakeCase, camelCase] = await Promise.all([
        getFirebaseAdminDb().collection("messages").where("thread_id", "==", threadId).orderBy("timestamp", "asc").get(),
        getFirebaseAdminDb().collection("messages").where("threadId", "==", threadId).orderBy("timestamp", "asc").get(),
      ]);

      return NextResponse.json({
        messages: uniqueById([...snakeCase.docs, ...camelCase.docs].map(mapMessageSnapshot)),
      });
    }

    await assertStayBelongsToHotel(stayId, hotelId);

    const [snakeCase, camelCase] = await Promise.all([
      getFirebaseAdminDb().collection("messages").where("stay_id", "==", stayId).orderBy("timestamp", "asc").get(),
      getFirebaseAdminDb().collection("messages").where("stayId", "==", stayId).orderBy("timestamp", "asc").get(),
    ]);

    return NextResponse.json({
      messages: uniqueById([...snakeCase.docs, ...camelCase.docs].map(mapMessageSnapshot)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status =
      message === "forbidden-role"
        ? 403
        : message === "missing-bearer-token"
          ? 401
          : message === "thread-not-found" || message === "stay-not-found"
            ? 404
            : message === "cross-hotel-thread" || message === "cross-hotel-stay"
              ? 403
              : 400;
    return jsonError(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await verifyHotelStaffIdentity();
    const hotelId = await resolveHotelIdForStaff({
      uid: identity.uid,
      claimedHotelId: identity.hotelId,
    });
    const body = (await request.json()) as Partial<{ threadId: string; body: string }>;

    if (!body.threadId || !body.body) {
      return jsonError("missing-required-fields", 400);
    }

    const message = await saveFrontDeskMessage({
      threadId: body.threadId,
      hotelId,
      staffUserId: identity.uid,
      body: body.body,
    });

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const status =
      message === "forbidden-role"
        ? 403
        : message === "missing-bearer-token"
          ? 401
          : message === "cross-hotel-thread"
            ? 403
            : 400;
    return jsonError(message, status);
  }
}
