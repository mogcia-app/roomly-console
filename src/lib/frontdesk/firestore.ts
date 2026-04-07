"use client";

import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { getFirestoreDb } from "@/lib/firebase";
import type {
  ChatThreadRecord,
  MessageRecord,
  RoomRecord,
  StayRecord,
} from "@/lib/frontdesk/types";

function mapStayRecord(docId: string, data: Record<string, unknown>): StayRecord {
  return {
    id: docId,
    hotel_id: typeof data.hotel_id === "string" ? data.hotel_id : typeof data.hotelId === "string" ? data.hotelId : "",
    room_id: typeof data.room_id === "string" ? data.room_id : typeof data.roomId === "string" ? data.roomId : "",
    is_active:
      typeof data.is_active === "boolean"
        ? data.is_active
        : typeof data.isActive === "boolean"
          ? data.isActive
          : data.status === "active",
    status: data.status === "checked_out" || data.status === "cancelled" ? data.status : "active",
    check_in_at: (data.check_in_at as StayRecord["check_in_at"]) ?? (data.checkInAt as StayRecord["check_in_at"]) ?? null,
    check_out_at:
      (data.check_out_at as StayRecord["check_out_at"]) ?? (data.checkOutAt as StayRecord["check_out_at"]) ?? null,
    scheduled_check_in_at:
      (data.scheduled_check_in_at as StayRecord["scheduled_check_in_at"]) ??
      (data.scheduledCheckInAt as StayRecord["scheduled_check_in_at"]) ??
      null,
    scheduled_check_out_at:
      (data.scheduled_check_out_at as StayRecord["scheduled_check_out_at"]) ??
      (data.scheduledCheckOutAt as StayRecord["scheduled_check_out_at"]) ??
      null,
    auto_checked_out_at:
      (data.auto_checked_out_at as StayRecord["auto_checked_out_at"]) ??
      (data.autoCheckedOutAt as StayRecord["auto_checked_out_at"]) ??
      null,
    check_out_mode:
      data.check_out_mode === "manual" || data.check_out_mode === "automatic"
        ? data.check_out_mode
        : data.checkOutMode === "manual" || data.checkOutMode === "automatic"
          ? data.checkOutMode
          : null,
    created_at: (data.created_at as StayRecord["created_at"]) ?? (data.createdAt as StayRecord["created_at"]) ?? null,
    updated_at: (data.updated_at as StayRecord["updated_at"]) ?? (data.updatedAt as StayRecord["updated_at"]) ?? null,
    guest_name:
      typeof data.guest_name === "string" ? data.guest_name : typeof data.guestName === "string" ? data.guestName : null,
    guest_count:
      typeof data.guest_count === "number" ? data.guest_count : typeof data.guestCount === "number" ? data.guestCount : null,
    reservation_id:
      typeof data.reservation_id === "string"
        ? data.reservation_id
        : typeof data.reservationId === "string"
          ? data.reservationId
          : null,
    checked_in_by:
      typeof data.checked_in_by === "string"
        ? data.checked_in_by
        : typeof data.checkedInBy === "string"
          ? data.checkedInBy
          : null,
    checked_out_by:
      typeof data.checked_out_by === "string"
        ? data.checked_out_by
        : typeof data.checkedOutBy === "string"
          ? data.checkedOutBy
          : null,
    notes: typeof data.notes === "string" ? data.notes : null,
  };
}

export function subscribeHumanThreads(
  hotelId: string,
  onData: (threads: ChatThreadRecord[]) => void,
  onError: (error: Error) => void,
) {
  const db = getFirestoreDb();
  const constraints: QueryConstraint[] = [
    where("hotel_id", "==", hotelId),
    where("mode", "==", "human"),
    where("status", "in", ["new", "in_progress"]),
    orderBy("updated_at", "desc"),
  ];

  return onSnapshot(
    query(collection(db, "chat_threads"), ...constraints),
    (snapshot) => {
      onData(
        snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...(docSnapshot.data() as Omit<ChatThreadRecord, "id">),
        })),
      );
    },
    onError,
  );
}

export function subscribeRecentThreads(
  hotelId: string,
  onData: (threads: ChatThreadRecord[]) => void,
  onError: (error: Error) => void,
) {
  const db = getFirestoreDb();
  const constraints: QueryConstraint[] = [
    where("hotel_id", "==", hotelId),
    where("mode", "==", "human"),
    orderBy("updated_at", "desc"),
  ];

  return onSnapshot(
    query(collection(db, "chat_threads"), ...constraints),
    (snapshot) => {
      onData(
        snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...(docSnapshot.data() as Omit<ChatThreadRecord, "id">),
        })),
      );
    },
    onError,
  );
}

export function subscribeHotelRooms(
  hotelId: string,
  onData: (rooms: RoomRecord[]) => void,
  onError: (error: Error) => void,
) {
  const db = getFirestoreDb();
  const constraints: QueryConstraint[] = [
    where("hotel_id", "==", hotelId),
    orderBy("room_number", "asc"),
  ];

  return onSnapshot(
    query(collection(db, "rooms"), ...constraints),
    (snapshot) => {
      onData(
        snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...(docSnapshot.data() as Omit<RoomRecord, "id">),
        })),
      );
    },
    onError,
  );
}

export function subscribeHotelStays(
  hotelId: string,
  onData: (stays: StayRecord[]) => void,
  onError: (error: Error) => void,
) {
  const db = getFirestoreDb();
  const staysById = new Map<string, StayRecord>();

  const emit = () => {
    onData(Array.from(staysById.values()));
  };

  const unsubscribeSnake = onSnapshot(
    query(collection(db, "stays"), where("hotel_id", "==", hotelId)),
    (snapshot) => {
      snapshot.docs.forEach((docSnapshot) => {
        staysById.set(docSnapshot.id, mapStayRecord(docSnapshot.id, docSnapshot.data() as Record<string, unknown>));
      });
      emit();
    },
    onError,
  );

  const unsubscribeCamel = onSnapshot(
    query(collection(db, "stays"), where("hotelId", "==", hotelId)),
    (snapshot) => {
      snapshot.docs.forEach((docSnapshot) => {
        staysById.set(docSnapshot.id, mapStayRecord(docSnapshot.id, docSnapshot.data() as Record<string, unknown>));
      });
      emit();
    },
    onError,
  );

  return () => {
    unsubscribeSnake();
    unsubscribeCamel();
  };
}

export function subscribeThreadMessages(
  threadId: string,
  onData: (messages: MessageRecord[]) => void,
  onError: (error: Error) => void,
) {
  const db = getFirestoreDb();
  const constraints: QueryConstraint[] = [
    where("thread_id", "==", threadId),
    orderBy("timestamp", "asc"),
  ];

  return onSnapshot(
    query(collection(db, "messages"), ...constraints),
    (snapshot) => {
      onData(
        snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...(docSnapshot.data() as Omit<MessageRecord, "id">),
        })),
      );
    },
    onError,
  );
}

async function getAuthorizationHeaders() {
  const auth = (await import("@/lib/firebase")).getFirebaseAuth();
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error("not-authenticated");
  }

  const token = await currentUser.getIdToken();

  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function acceptHumanThread(threadId: string, staffUserId: string) {
  const db = getFirestoreDb();
  const threadRef = doc(db, "chat_threads", threadId);

  await runTransaction(db, async (transaction) => {
    const threadSnapshot = await transaction.get(threadRef);

    if (!threadSnapshot.exists()) {
      throw new Error("thread-not-found");
    }

    const thread = threadSnapshot.data() as Omit<ChatThreadRecord, "id">;

    if (thread.status === "resolved") {
      throw new Error("thread-resolved");
    }

    if (thread.status === "in_progress" && thread.assigned_to && thread.assigned_to !== staffUserId) {
      throw new Error("thread-assigned");
    }

    transaction.update(threadRef, {
      status: "in_progress",
      assigned_to: staffUserId,
      assigned_at: thread.assigned_at ?? serverTimestamp(),
      updated_at: serverTimestamp(),
    });
  });
}

export async function assignHumanThread(threadId: string, staffUserId: string) {
  const db = getFirestoreDb();
  const threadRef = doc(db, "chat_threads", threadId);

  await runTransaction(db, async (transaction) => {
    const threadSnapshot = await transaction.get(threadRef);

    if (!threadSnapshot.exists()) {
      throw new Error("thread-not-found");
    }

    const thread = threadSnapshot.data() as Omit<ChatThreadRecord, "id">;

    if (thread.status === "resolved") {
      throw new Error("thread-resolved");
    }

    transaction.update(threadRef, {
      status: "in_progress",
      assigned_to: staffUserId,
      assigned_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
  });
}

export async function resolveHumanThread(threadId: string, staffUserId: string) {
  const db = getFirestoreDb();
  const threadRef = doc(db, "chat_threads", threadId);

  await runTransaction(db, async (transaction) => {
    const threadSnapshot = await transaction.get(threadRef);

    if (!threadSnapshot.exists()) {
      throw new Error("thread-not-found");
    }

    const thread = threadSnapshot.data() as Omit<ChatThreadRecord, "id">;

    if (thread.status === "resolved") {
      return;
    }

    transaction.update(threadRef, {
      status: "resolved",
      resolved_by: staffUserId,
      resolved_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
  });
}

export async function sendFrontMessage(
  threadId: string,
  _staffUserId: string,
  body: string,
) {
  const trimmedBody = body.trim();

  if (!trimmedBody) {
    throw new Error("empty-message");
  }

  const response = await fetch("/api/frontdesk/messages", {
    method: "POST",
    headers: await getAuthorizationHeaders(),
    body: JSON.stringify({
      threadId,
      body: trimmedBody,
    }),
  });

  const payload = (await response.json()) as { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? "failed-to-send-front-message");
  }
}

export async function markThreadSeenByFront(threadId: string) {
  const db = getFirestoreDb();
  const threadRef = doc(db, "chat_threads", threadId);

  await updateDoc(threadRef, {
    unread_count_front: 0,
    last_seen_by_front_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
}
