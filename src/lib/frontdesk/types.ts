import type { Timestamp } from "firebase/firestore";

export type CallStatus = "queue" | "active" | "unavailable" | "ended";
export type CallDirection = "guest_to_front" | "front_to_guest";
export type CallInitiator = "guest" | "front";

export type ThreadMode = "ai" | "human";
export type ThreadStatus = "new" | "in_progress" | "resolved";
export type MessageSender = "guest" | "ai" | "front" | "system";

export type FirestoreDate = Timestamp | null | undefined;

export type WebRtcSessionDescription = {
  sdp: string;
  type: "answer" | "offer";
};

export type WebRtcIceCandidate = {
  candidate: string;
  sdpMLineIndex: number | null;
  sdpMid: string | null;
  usernameFragment?: string | null;
};

export type CallRecord = {
  id: string;
  stay_id: string;
  room_id: string;
  room_number?: string;
  hotel_id?: string;
  thread_id?: string;
  guest_lang: string;
  status: CallStatus;
  direction?: CallDirection;
  initiated_by?: CallInitiator;
  translated: boolean;
  is_active?: boolean;
  emergency?: boolean;
  event_type?: "call_requested" | "call_accepted" | "call_missed" | "call_ended" | "call_failed";
  created_at?: FirestoreDate;
  updated_at?: FirestoreDate;
  ended_at?: FirestoreDate;
  timed_out_at?: FirestoreDate;
  accepted_by?: string;
  accepted_at?: FirestoreDate;
  requested_by_staff_uid?: string;
  offer_sdp?: WebRtcSessionDescription;
  answer_sdp?: WebRtcSessionDescription;
  guest_ice_candidates?: WebRtcIceCandidate[];
  front_ice_candidates?: WebRtcIceCandidate[];
  webrtc_status?: "waiting_offer" | "answering" | "connected" | "failed";
  connected_at?: FirestoreDate;
};

export type ChatThreadRecord = {
  id: string;
  stay_id: string;
  room_id: string;
  room_number?: string;
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
  sender: MessageSender;
  body: string;
  timestamp?: FirestoreDate;
  translated_body_guest?: string;
  translated_body_front?: string;
  category?: string;
  priority?: string;
};

export type InquiryHistoryItem = {
  id: string;
  source: "call" | "chat";
  room_id: string;
  room_number?: string;
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
  ended_at?: FirestoreDate;
  resolved_at?: FirestoreDate;
  assigned_to?: string;
  accepted_by?: string;
};
