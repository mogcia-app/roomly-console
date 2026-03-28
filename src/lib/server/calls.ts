import { FieldValue } from "firebase-admin/firestore";
import type { CallRecord } from "@/lib/frontdesk/types";
import { getFirebaseAdminDb } from "@/lib/server/firebase-admin";

export type CallUpdateAction = "accept" | "mark-unavailable" | "end";

export async function updateCallStatus(callId: string, hotelId: string, staffUserId: string, action: CallUpdateAction) {
  const db = getFirebaseAdminDb();
  const callRef = db.collection("calls").doc(callId);

  await db.runTransaction(async (transaction) => {
    const callSnapshot = await transaction.get(callRef);

    if (!callSnapshot.exists) {
      throw new Error("call-not-found");
    }

    const call = callSnapshot.data() as Omit<CallRecord, "id">;

    if (call.hotel_id !== hotelId) {
      throw new Error("forbidden-hotel");
    }

    switch (action) {
      case "accept":
        if (call.status !== "queue") {
          throw new Error("call-already-handled");
        }
        transaction.update(callRef, {
          status: "active",
          accepted_by: staffUserId,
          accepted_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
        return;
      case "mark-unavailable":
        if (call.status !== "queue") {
          throw new Error("call-not-queued");
        }
        transaction.update(callRef, {
          status: "unavailable",
          timed_out_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
        return;
      case "end":
        if (call.status !== "active") {
          throw new Error("call-not-active");
        }
        transaction.update(callRef, {
          status: "ended",
          ended_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
        return;
      default:
        throw new Error("invalid-call-action");
    }
  });
}
