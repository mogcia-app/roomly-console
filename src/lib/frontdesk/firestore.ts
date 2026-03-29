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
  InquiryHistoryItem,
  MessageRecord,
} from "@/lib/frontdesk/types";

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

export function buildInquiryHistory(threads: ChatThreadRecord[]): InquiryHistoryItem[] {
  const threadItems: InquiryHistoryItem[] = threads.map((thread) => ({
    id: thread.id,
    source: "chat",
    room_id: thread.room_id,
    room_number: thread.room_number,
    stay_id: thread.stay_id,
    hotel_id: thread.hotel_id,
    guest_language: thread.guest_language,
    category: thread.category,
    event_type:
      thread.event_type ??
      (thread.emergency
        ? "emergency_detected"
        : thread.status === "in_progress"
          ? "chat_handoff_accepted"
          : "chat_handoff_requested"),
    status: thread.status ?? "new",
    emergency: Boolean(thread.emergency),
    created_at: thread.created_at,
    updated_at: thread.updated_at,
    started_at: thread.assigned_at,
    resolved_at: thread.resolved_at,
    assigned_to: thread.assigned_to,
  }));

  return threadItems.sort((left, right) => {
    const leftTime = left.updated_at?.toDate().getTime() ?? 0;
    const rightTime = right.updated_at?.toDate().getTime() ?? 0;
    return rightTime - leftTime;
  });
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
  staffUserId: string,
  body: string,
) {
  const db = getFirestoreDb();
  const trimmedBody = body.trim();

  if (!trimmedBody) {
    throw new Error("empty-message");
  }

  const threadRef = doc(db, "chat_threads", threadId);
  const messageRef = doc(collection(db, "messages"));

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

    transaction.set(messageRef, {
      thread_id: threadId,
      sender: "front",
      body: trimmedBody,
      timestamp: serverTimestamp(),
    });

    transaction.update(threadRef, {
      status: "in_progress",
      assigned_to: staffUserId,
      assigned_at: thread.assigned_at ?? serverTimestamp(),
      last_message_body: trimmedBody,
      last_message_at: serverTimestamp(),
      last_message_sender: "front",
      unread_count_front: 0,
      updated_at: serverTimestamp(),
    });
  });
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
