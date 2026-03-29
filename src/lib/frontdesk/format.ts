import type { FirestoreDate, MessageSender } from "@/lib/frontdesk/types";

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(value: FirestoreDate) {
  if (!value) {
    return "未設定";
  }

  return dateTimeFormatter.format(value.toDate());
}

export function formatIsoDateTime(value?: string | null) {
  if (!value) {
    return "未設定";
  }

  return dateTimeFormatter.format(new Date(value));
}

export function formatTime(value: FirestoreDate) {
  if (!value) {
    return "--:--";
  }

  return timeFormatter.format(value.toDate());
}

export function formatRoomLabel(roomId: string, roomNumber?: string) {
  if (roomNumber) {
    return `${roomNumber}号室`;
  }

  return roomId ? `${roomId}号室` : "部屋未設定";
}

export function formatSenderLabel(sender: MessageSender) {
  switch (sender) {
    case "guest":
      return "ゲスト";
    case "ai":
      return "AI";
    case "front":
      return "フロント";
    case "system":
      return "システム";
    default:
      return sender;
  }
}

export function formatInquiryType(eventType?: string, source?: "call" | "chat") {
  switch (eventType) {
    case "chat_ai_started":
      return "AIチャット";
    case "chat_handoff_requested":
      return "フロントチャット希望";
    case "chat_handoff_accepted":
      return "チャット対応開始";
    case "chat_human_message":
      return "チャット返信";
    case "emergency_detected":
      return "緊急通知";
    default:
      return source === "chat" ? "チャット" : "問い合わせ";
  }
}

export function formatStatusLabel(status?: string) {
  switch (status) {
    case "in_progress":
      return "対応中";
    case "resolved":
      return "完了";
    case "new":
      return "新着";
    default:
      return status ?? "未設定";
  }
}
