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

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" ? value : 0;
}

function mapThreadRecord(docId: string, data: Record<string, unknown>): ChatThreadRecord {
  return {
    id: docId,
    stay_id: readString(data.stay_id) || readString(data.stayId),
    stayId: readString(data.stayId) || undefined,
    room_id: readString(data.room_id) || readString(data.roomId),
    roomId: readString(data.roomId) || undefined,
    room_number: readString(data.room_number) || readString(data.roomNumber) || undefined,
    room_display_name: readNullableString(data.room_display_name) ?? readNullableString(data.roomDisplayName),
    hotel_id: readString(data.hotel_id) || readString(data.hotelId) || undefined,
    mode: data.mode === "ai" ? "ai" : "human",
    status:
      data.status === "new" || data.status === "in_progress" || data.status === "resolved" ? data.status : "new",
    category: readString(data.category) || undefined,
    guest_language: readString(data.guest_language) || readString(data.guestLanguage) || undefined,
    is_active:
      typeof data.is_active === "boolean"
        ? data.is_active
        : typeof data.isActive === "boolean"
          ? data.isActive
          : undefined,
    emergency: typeof data.emergency === "boolean" ? data.emergency : undefined,
    event_type:
      typeof data.event_type === "string"
        ? (data.event_type as ChatThreadRecord["event_type"])
        : typeof data.eventType === "string"
          ? (data.eventType as ChatThreadRecord["event_type"])
          : undefined,
    created_at: (data.created_at as ChatThreadRecord["created_at"]) ?? (data.createdAt as ChatThreadRecord["created_at"]) ?? null,
    updated_at: (data.updated_at as ChatThreadRecord["updated_at"]) ?? (data.updatedAt as ChatThreadRecord["updated_at"]) ?? null,
    assigned_to: readString(data.assigned_to) || readString(data.assignedTo) || undefined,
    assigned_at: (data.assigned_at as ChatThreadRecord["assigned_at"]) ?? (data.assignedAt as ChatThreadRecord["assigned_at"]) ?? null,
    resolved_by: readString(data.resolved_by) || readString(data.resolvedBy) || undefined,
    resolved_at: (data.resolved_at as ChatThreadRecord["resolved_at"]) ?? (data.resolvedAt as ChatThreadRecord["resolved_at"]) ?? null,
    last_message_body: readString(data.last_message_body) || readString(data.lastMessageBody) || undefined,
    last_message_at:
      (data.last_message_at as ChatThreadRecord["last_message_at"]) ?? (data.lastMessageAt as ChatThreadRecord["last_message_at"]) ?? null,
    last_message_sender:
      data.last_message_sender === "guest" || data.last_message_sender === "ai" || data.last_message_sender === "front" || data.last_message_sender === "system"
        ? data.last_message_sender
        : data.lastMessageSender === "guest" || data.lastMessageSender === "ai" || data.lastMessageSender === "front" || data.lastMessageSender === "system"
          ? data.lastMessageSender
          : undefined,
    unread_count_front: readNumber(data.unread_count_front ?? data.unreadCountFront),
    unread_count_guest: readNumber(data.unread_count_guest ?? data.unreadCountGuest),
    last_seen_by_front_at:
      (data.last_seen_by_front_at as ChatThreadRecord["last_seen_by_front_at"]) ??
      (data.lastSeenByFrontAt as ChatThreadRecord["last_seen_by_front_at"]) ??
      null,
  };
}

function mapMessageRecord(docId: string, data: Record<string, unknown>): MessageRecord {
  return {
    id: docId,
    thread_id: readString(data.thread_id) || readString(data.threadId),
    stay_id: readString(data.stay_id) || readString(data.stayId) || undefined,
    room_id: readString(data.room_id) || readString(data.roomId) || undefined,
    sender:
      data.sender === "guest" || data.sender === "ai" || data.sender === "front" || data.sender === "system"
        ? data.sender
        : "system",
    body: readString(data.body),
    timestamp: (data.timestamp as MessageRecord["timestamp"]) ?? null,
    original_body: readString(data.original_body) || readString(data.originalBody) || undefined,
    original_language: readString(data.original_language) || readString(data.originalLanguage) || undefined,
    translated_body_guest: readString(data.translated_body_guest) || readString(data.translatedBodyGuest) || undefined,
    translated_language_guest:
      readString(data.translated_language_guest) || readString(data.translatedLanguageGuest) || undefined,
    translated_body_front: readString(data.translated_body_front) || readString(data.translatedBodyFront) || undefined,
    translated_language_front:
      readString(data.translated_language_front) || readString(data.translatedLanguageFront) || undefined,
    translation_state:
      data.translation_state === "not_required" || data.translation_state === "fallback" || data.translation_state === "ready"
        ? data.translation_state
        : data.translationState === "not_required" || data.translationState === "fallback" || data.translationState === "ready"
          ? data.translationState
          : undefined,
    category: readString(data.category) || undefined,
    image_url: readString(data.image_url) || readString(data.imageUrl) || undefined,
    image_alt: readString(data.image_alt) || readString(data.imageAlt) || undefined,
    priority: readString(data.priority) || undefined,
    read_at_guest: (data.read_at_guest as MessageRecord["read_at_guest"]) ?? null,
    readAtGuest: (data.readAtGuest as MessageRecord["readAtGuest"]) ?? null,
    read_at: (data.read_at as MessageRecord["read_at"]) ?? null,
    readAt: (data.readAt as MessageRecord["readAt"]) ?? null,
    seen_at_guest: (data.seen_at_guest as MessageRecord["seen_at_guest"]) ?? null,
    seenAtGuest: (data.seenAtGuest as MessageRecord["seenAtGuest"]) ?? null,
  };
}

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
    guest_language:
      typeof data.guest_language === "string"
        ? data.guest_language
        : typeof data.guestLanguage === "string"
          ? data.guestLanguage
          : typeof data.language === "string"
            ? data.language
            : null,
    translation_enabled:
      typeof data.translation_enabled === "boolean"
        ? data.translation_enabled
        : typeof data.translationEnabled === "boolean"
          ? data.translationEnabled
          : null,
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
        snapshot.docs.map((docSnapshot) => mapThreadRecord(docSnapshot.id, docSnapshot.data() as Record<string, unknown>)),
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
    orderBy("updated_at", "desc"),
  ];

  return onSnapshot(
    query(collection(db, "chat_threads"), ...constraints),
    (snapshot) => {
      onData(
        snapshot.docs.map((docSnapshot) => mapThreadRecord(docSnapshot.id, docSnapshot.data() as Record<string, unknown>)),
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
        snapshot.docs.map((docSnapshot) => mapMessageRecord(docSnapshot.id, docSnapshot.data() as Record<string, unknown>)),
      );
    },
    onError,
  );
}

export function subscribeStayMessages(
  stayId: string,
  onData: (messages: MessageRecord[]) => void,
  onError: (error: Error) => void,
) {
  const db = getFirestoreDb();
  const messagesById = new Map<string, MessageRecord>();

  const emit = () => {
    onData(
      Array.from(messagesById.values()).sort(
        (left, right) => (left.timestamp?.toDate().getTime() ?? 0) - (right.timestamp?.toDate().getTime() ?? 0),
      ),
    );
  };

  const subscribeToField = (field: "stay_id" | "stayId") =>
    onSnapshot(
      query(collection(db, "messages"), where(field, "==", stayId), orderBy("timestamp", "asc")),
      (snapshot) => {
        snapshot.docs.forEach((docSnapshot) => {
          messagesById.set(docSnapshot.id, mapMessageRecord(docSnapshot.id, docSnapshot.data() as Record<string, unknown>));
        });
        emit();
      },
      onError,
    );

  const unsubscribeSnake = subscribeToField("stay_id");
  const unsubscribeCamel = subscribeToField("stayId");

  return () => {
    unsubscribeSnake();
    unsubscribeCamel();
  };
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

export async function requestTranslationPreview(params: {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}) {
  const response = await fetch("/api/frontdesk/translation-preview", {
    method: "POST",
    headers: await getAuthorizationHeaders(),
    body: JSON.stringify(params),
  });

  const payload = (await response.json()) as {
    error?: string;
    translatedText?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? "failed-to-translate-preview");
  }

  return typeof payload.translatedText === "string" ? payload.translatedText : "";
}

export async function markGuestMessagesRead(threadId: string, messageIds?: string[]) {
  const response = await fetch(`/api/admin/guest-threads/${threadId}/read`, {
    method: "POST",
    headers: await getAuthorizationHeaders(),
    body: JSON.stringify(
      messageIds && messageIds.length > 0
        ? {
            messageIds,
          }
        : {},
    ),
  });

  const payload = (await response.json()) as { error?: string; ok?: boolean; updatedCount?: number };

  if (!response.ok) {
    throw new Error(payload.error ?? "failed-to-mark-guest-messages-read");
  }

  return payload.updatedCount ?? 0;
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
