import type { Timestamp } from "firebase/firestore";

export type ThreadMode = "ai" | "human";
export type ThreadStatus = "new" | "in_progress" | "resolved";
export type MessageSender = "guest" | "ai" | "front" | "system";
export type TranslationState = "not_required" | "fallback" | "ready";

export type FirestoreDate = Timestamp | null | undefined;

export type ChatThreadRecord = {
  id: string;
  stay_id: string;
  stayId?: string;
  room_id: string;
  roomId?: string;
  room_number?: string;
  room_display_name?: string | null;
  hotel_id?: string;
  mode: ThreadMode;
  status?: ThreadStatus;
  category?: string;
  guest_language?: string;
  is_active?: boolean;
  emergency?: boolean;
  event_type?:
    | "chat_ai_started"
    | "chat_handoff_requested"
    | "chat_handoff_accepted"
    | "chat_human_message"
    | "emergency_detected";
  created_at?: FirestoreDate;
  updated_at?: FirestoreDate;
  assigned_to?: string;
  assigned_at?: FirestoreDate;
  resolved_by?: string;
  resolved_at?: FirestoreDate;
  last_message_body?: string;
  last_message_at?: FirestoreDate;
  last_message_sender?: MessageSender;
  unread_count_front?: number;
  unread_count_guest?: number;
  last_seen_by_front_at?: FirestoreDate;
};

export type MessageRecord = {
  id: string;
  thread_id: string;
  stay_id?: string;
  room_id?: string;
  sender: MessageSender;
  body: string;
  timestamp?: FirestoreDate;
  original_body?: string;
  original_language?: string;
  translated_body_guest?: string;
  translated_language_guest?: string;
  translated_body_front?: string;
  translated_language_front?: string;
  translation_state?: TranslationState;
  category?: string;
  image_url?: string;
  image_alt?: string;
  priority?: string;
  read_at_guest?: FirestoreDate;
  readAtGuest?: FirestoreDate;
  read_at?: FirestoreDate;
  readAt?: FirestoreDate;
  seen_at_guest?: FirestoreDate;
  seenAtGuest?: FirestoreDate;
};

export type InquiryHistoryItem = {
  id: string;
  source: "chat";
  room_id: string;
  room_number?: string;
  room_display_name?: string | null;
  stay_id: string;
  hotel_id?: string;
  guest_language?: string;
  category?: string;
  event_type: string;
  status: string;
  emergency: boolean;
  created_at?: FirestoreDate;
  updated_at?: FirestoreDate;
  started_at?: FirestoreDate;
  resolved_at?: FirestoreDate;
  assigned_to?: string;
};

export type RoomRecord = {
  id: string;
  room_id: string;
  hotel_id: string;
  room_number: string;
  display_name?: string | null;
  floor?: string | null;
  room_type?: string | null;
  updated_at?: FirestoreDate;
};

export type StayStatus = "active" | "checked_out" | "cancelled";

export type StayRecord = {
  id: string;
  hotel_id: string;
  room_id: string;
  is_active: boolean;
  status: StayStatus;
  guest_language?: string | null;
  translation_enabled?: boolean | null;
  check_in_at?: FirestoreDate;
  check_out_at?: FirestoreDate;
  scheduled_check_in_at?: FirestoreDate;
  scheduled_check_out_at?: FirestoreDate;
  auto_checked_out_at?: FirestoreDate;
  check_out_mode?: "manual" | "automatic" | null;
  created_at?: FirestoreDate;
  updated_at?: FirestoreDate;
  guest_name?: string | null;
  guest_count?: number | null;
  reservation_id?: string | null;
  checked_in_by?: string | null;
  checked_out_by?: string | null;
  notes?: string | null;
};

export type RoomOccupancyStatus = "vacant" | "occupied" | "conflict";

export type RoomStatusRecord = {
  room: RoomRecord;
  status: RoomOccupancyStatus;
  active_stays: StayRecord[];
  active_stay?: StayRecord | null;
};
