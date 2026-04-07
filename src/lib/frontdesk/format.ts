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

function toDisplayDate(value: FirestoreDate | Date | string | { seconds?: number; _seconds?: number } | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const parsed = value.toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }

  if (typeof value === "object") {
    const objectValue = value as { seconds?: number; _seconds?: number };
    const seconds =
      typeof objectValue.seconds === "number"
        ? objectValue.seconds
        : typeof objectValue._seconds === "number"
          ? objectValue._seconds
          : null;

    if (seconds !== null) {
      const parsed = new Date(seconds * 1000);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  return null;
}

export function formatDateTime(value: FirestoreDate) {
  const parsed = toDisplayDate(value);
  if (!parsed) {
    return "未設定";
  }

  return dateTimeFormatter.format(parsed);
}

export function formatIsoDateTime(value?: string | null) {
  if (!value) {
    return "未設定";
  }

  return dateTimeFormatter.format(new Date(value));
}

export function formatTime(value: FirestoreDate) {
  const parsed = toDisplayDate(value);
  if (!parsed) {
    return "--:--";
  }

  return timeFormatter.format(parsed);
}

export function formatRoomLabel(roomId: string, roomNumber?: string, displayName?: string | null) {
  const trimmedDisplayName = displayName?.trim();

  if (trimmedDisplayName) {
    return trimmedDisplayName;
  }

  const base = roomNumber || roomId;

  if (!base) {
    return "部屋未設定";
  }

  return base;
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
