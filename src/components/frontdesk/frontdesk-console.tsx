"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { HotelAuthCard } from "@/components/auth/hotel-auth-card";
import { FrontdeskAuthLoading } from "@/components/frontdesk/frontdesk-auth-loading";
import { FrontdeskShell } from "@/components/frontdesk/frontdesk-shell";
import {
  markThreadSeenByFront,
  markGuestMessagesRead,
  requestTranslationPreview,
  sendFrontMessage,
} from "@/lib/frontdesk/firestore";
import { formatGuestLanguageLabel } from "@/lib/frontdesk/languages";
import {
  formatInquiryType,
  formatRoomLabel,
  formatSenderLabel,
  formatTime,
} from "@/lib/frontdesk/format";
import { FRONTDESK_NOTIFICATION_ENABLED_KEY } from "@/lib/frontdesk/preferences";
import type { ChatThreadRecord, MessageRecord } from "@/lib/frontdesk/types";
import { useHotelRooms, useHotelStays, useRecentThreads, useThreadMessages } from "@/hooks/useFrontdeskData";
import { useHotelAuth } from "@/hooks/useHotelAuth";
import { useFrontdeskPushNotifications } from "@/hooks/useFrontdeskPushNotifications";
import { useCompactModePreference } from "@/hooks/useFrontdeskPreferences";
import { useHotelReplyTemplates } from "@/hooks/useHotelReplyTemplates";

const defaultHotelId = process.env.NEXT_PUBLIC_DEFAULT_HOTEL_ID ?? "";

type ActionState = {
  kind: "success" | "error";
  message: string;
} | null;

type MobilePane = "list" | "chat";
type StayFilter = "active" | "checked_out" | "all";
type ModeFilter = "all" | ChatThreadRecord["mode"];

function isEmergencyCategory(category?: string | null) {
  return (category ?? "").startsWith("emergency_");
}

function resolveEmergencyLabel(category?: string | null) {
  switch (category) {
    case "emergency_medical":
      return "体調不良";
    case "emergency_fire":
      return "火災・事故";
    case "emergency_safety":
      return "安全トラブル";
    case "emergency_other":
      return "その他緊急";
    default:
      return "緊急";
  }
}

function isEmergencyThread(item: { emergency?: boolean; category?: string | null }) {
  return Boolean(item.emergency) || isEmergencyCategory(item.category);
}

function priorityValue(item: { emergency?: boolean; status?: string; category?: string | null }) {
  if (isEmergencyThread(item)) {
    return 0;
  }

  if (item.status === "new") {
    return 1;
  }

  if (item.status === "in_progress") {
    return 2;
  }

  return 3;
}

function toMillis(value: unknown) {
  if (!value || typeof value !== "object" || !("toDate" in value) || typeof value.toDate !== "function") {
    return 0;
  }

  const parsed = value.toDate();
  return parsed instanceof Date ? parsed.getTime() : 0;
}

function sortByPriority<T extends { emergency?: boolean; status?: string; updated_at?: { toDate(): Date } | null }>(
  items: T[],
) {
  return [...items].sort((left, right) => {
    const priorityDiff = priorityValue(left) - priorityValue(right);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const rightLastMessageAt = "last_message_at" in right ? toMillis(right.last_message_at) : 0;
    const leftLastMessageAt = "last_message_at" in left ? toMillis(left.last_message_at) : 0;

    if (rightLastMessageAt !== leftLastMessageAt) {
      return rightLastMessageAt - leftLastMessageAt;
    }

    return (right.updated_at?.toDate().getTime() ?? 0) - (left.updated_at?.toDate().getTime() ?? 0);
  });
}

function playEmergencyAlertTone() {
  if (typeof window === "undefined" || !("AudioContext" in window || "webkitAudioContext" in window)) {
    return;
  }

  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  const context = new AudioContextClass();
  const now = context.currentTime;

  for (let index = 0; index < 4; index += 1) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = now + index * 0.28;
    const duration = 0.22;

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(index % 2 === 0 ? 880 : 660, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration);
  }

  window.setTimeout(() => {
    void context.close().catch(() => {
      // Ignore close failures; this is best-effort alert audio.
    });
  }, 1600);
}

function resolveRoomLabel(
  roomId: string,
  roomNumber: string | undefined,
  roomDisplayName: string | null | undefined,
  roomDisplayNames: Map<string, string | null>,
) {
  return formatRoomLabel(roomId, roomNumber, roomDisplayName ?? roomDisplayNames.get(roomId));
}

function resolveFrontMessageBody(message: MessageRecord) {
  if (message.sender === "front") {
    return message.original_body ?? message.body;
  }

  return message.translated_body_front ?? message.body ?? message.original_body ?? "";
}

function resolveMessageMeta(message: MessageRecord) {
  if (message.sender === "front") {
    const translatedGuestBody =
      message.translated_body_guest && message.translated_body_guest !== (message.original_body ?? message.body)
        ? message.translated_body_guest
        : "";

    return {
      primaryLabel: "原文",
      originalBody: "",
      translatedGuestBody,
      translationState: message.translation_state ?? "",
      languageLabel: message.translated_language_guest ?? "",
    };
  }

  const originalBody =
    message.original_body && message.original_body !== (message.translated_body_front ?? message.body)
      ? message.original_body
      : "";

  return {
    primaryLabel: "翻訳",
    originalBody,
    translatedGuestBody: "",
    translationState: message.translation_state ?? "",
    languageLabel: message.original_language ?? "",
  };
}

function resolveStayFilterLabel(filter: StayFilter) {
  switch (filter) {
    case "active":
      return "滞在中";
    case "checked_out":
      return "済み";
    default:
      return "全履歴";
  }
}

function resolveModeLabel(mode: ChatThreadRecord["mode"]) {
  return mode === "ai" ? "AI" : "Staff";
}

function resolveThreadStayState(
  thread: ChatThreadRecord,
  stayStates: Map<string, "active" | "checked_out" | "unknown">,
): "active" | "checked_out" | "unknown" {
  const stayId = (thread.stay_id ?? thread.stayId ?? "").trim();
  if (!stayId) {
    return "unknown";
  }

  return stayStates.get(stayId) ?? "unknown";
}

function resolveDispatchTimestampSegment(thread: ChatThreadRecord) {
  const target = thread.last_message_at ?? thread.updated_at;
  if (!target) {
    return "";
  }

  if (typeof target === "object" && "seconds" in target && typeof target.seconds === "number") {
    const nanos = "nanoseconds" in target && typeof target.nanoseconds === "number" ? target.nanoseconds : 0;
    return `${target.seconds}:${nanos}`;
  }

  if (typeof target === "object" && "toDate" in target && typeof target.toDate === "function") {
    return `${target.toDate().getTime()}`;
  }

  return "";
}

function resolveThreadDispatchKey(thread: ChatThreadRecord) {
  const timestampSegment = resolveDispatchTimestampSegment(thread);
  if (!timestampSegment) {
    return "";
  }

  return `${thread.id}:${timestampSegment}:${thread.last_message_sender ?? "unknown"}`;
}

function isArchivedCheckedOutStay(value: unknown) {
  const archivedAt = toMillis(value);
  if (!archivedAt) {
    return false;
  }

  return Date.now() - archivedAt >= 24 * 60 * 60 * 1000;
}

function ThreadListCard({
  thread,
  guestName,
  roomLabel,
  isSelected,
  selectedByOther,
  stayState,
  onClick,
}: {
  thread: ChatThreadRecord;
  guestName?: string | null;
  roomLabel: string;
  isSelected: boolean;
  selectedByOther: boolean;
  stayState: "active" | "checked_out" | "unknown";
  onClick: () => void;
}) {
  const roomInitial = roomLabel.slice(0, 1) || "客";
  const emergencyLabel = isEmergencyCategory(thread.category) ? resolveEmergencyLabel(thread.category) : "";

  return (
    <button
      type="button"
      className={`w-full rounded-[8px] border px-4 py-3.5 text-left transition ${
        isEmergencyThread(thread)
          ? isSelected
            ? "border-[#c33b2b] bg-[#fff1ef] shadow-[0_12px_28px_rgba(173,34,24,0.16)]"
            : "border-[#efb8b2] bg-[#fff8f7] hover:border-[#d95e52] hover:bg-[#fff1ef]"
          : isSelected
            ? "border-[#e1b8b3] bg-[#fff4f2] shadow-[0_10px_24px_rgba(173,34,24,0.10)]"
            : "border-[#ead8d5] bg-white hover:border-[#ddb5af] hover:bg-[#fffafa]"
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-base font-semibold ${
            isSelected ? "bg-[#ad2218] text-white" : "bg-[#fff1ef] text-[#7d2a22]"
          }`}
        >
          {roomInitial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="truncate text-[15px] font-semibold text-stone-950">
              {roomLabel}
              {guestName ? <span className="ml-2 font-medium text-stone-500">/ {guestName}</span> : null}
            </h3>
            <span className="shrink-0 text-[11px] text-stone-400">{formatTime(thread.updated_at)}</span>
          </div>
          <p className="mt-1 line-clamp-1 text-sm text-stone-500">
            {thread.last_message_body ?? thread.category ?? formatInquiryType(thread.event_type, "chat")}
          </p>
          <div className="mt-3 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-stone-400">
              {emergencyLabel ? (
                <span className="rounded-full bg-[#ad2218] px-2 py-1 text-[11px] font-semibold text-white">
                  {emergencyLabel}
                </span>
              ) : null}
              <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                thread.mode === "ai" ? "bg-[#f2e8ff] text-[#6c3baa]" : "bg-[#fff1ef] text-[#ad2218]"
              }`}>
                {resolveModeLabel(thread.mode)}
              </span>
              <span>{thread.guest_language ? formatGuestLanguageLabel(thread.guest_language) : "言語未設定"}</span>
              {selectedByOther ? <span>他スタッフ対応中</span> : null}
              {stayState === "checked_out" ? (
                <span className="rounded-full bg-stone-200 px-2 py-1 text-[11px] font-semibold text-stone-700">
                  チェックアウト済み
                </span>
              ) : null}
            </div>
            {(thread.unread_count_front ?? 0) > 0 ? (
              <span className="block h-2.5 w-2.5 rounded-full bg-[#ad2218]" aria-label="未読あり" />
            ) : thread.emergency ? (
              <span className="rounded-full bg-[#fff3f1] px-2 py-1 text-[11px] font-semibold text-[#d14b3d]">緊急</span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

export function FrontdeskConsole() {
  const searchParams = useSearchParams();
  const requestedThreadId = searchParams.get("threadId") ?? "";
  const requestedStayId = searchParams.get("stayId") ?? "";
  const { user, claims, isLoading: authLoading, error: authError, login, logout } = useHotelAuth();
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [actionState, setActionState] = useState<ActionState>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>(() =>
    requestedThreadId || requestedStayId ? "chat" : "list",
  );
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [fallbackTranslations, setFallbackTranslations] = useState<Record<string, string>>({});
  const [stayFilter, setStayFilter] = useState<StayFilter>("active");
  const [checkedOutCollapsed, setCheckedOutCollapsed] = useState(true);
  const [archivedCollapsed, setArchivedCollapsed] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [isPending, startUiTransition] = useTransition();
  const notifiedThreadIdsRef = useState(() => new Set<string>())[0];
  const pendingFallbackTranslationIdsRef = useState(() => new Set<string>())[0];
  const emergencyAlertThreadIdsRef = useState(() => new Set<string>())[0];
  const [compactMode] = useCompactModePreference();
  const role = claims?.role;
  const canOperate = role === "hotel_front" || role === "hotel_admin";
  const pushNotifications = useFrontdeskPushNotifications({
    enabled: canOperate,
    user,
  });
  const notifiedDispatchKeysRef = useState(() => new Set<string>())[0];

  const hotelId = useDeferredValue((claims?.hotel_id ?? defaultHotelId).trim());
  const staffUserId = useDeferredValue(user?.uid ?? "");
  const replyTemplatesState = useHotelReplyTemplates(Boolean(user && canOperate));
  const availableReplyTemplates = useMemo(
    () => replyTemplatesState.templates.filter((template) => template.label.trim() && template.body.trim()),
    [replyTemplatesState.templates],
  );
  const recentThreads = useRecentThreads(hotelId);
  const hotelRooms = useHotelRooms(hotelId);
  const hotelStays = useHotelStays(hotelId);

  const prioritizedThreads = useMemo(
    () => sortByPriority(recentThreads.data),
    [recentThreads.data],
  );
  const threadSummary = useMemo(
    () => ({
      total: prioritizedThreads.length,
      newCount: prioritizedThreads.filter((thread) => thread.status === "new").length,
      emergencyCount: prioritizedThreads.filter((thread) => thread.emergency).length,
    }),
    [prioritizedThreads],
  );
  const roomDisplayNames = useMemo(
    () => new Map(hotelRooms.data.map((room) => [room.room_id || room.id, room.display_name ?? null])),
    [hotelRooms.data],
  );
  const stayStates = useMemo(
    () =>
      new Map<string, "active" | "checked_out" | "unknown">(
        hotelStays.data.map((stay) => [
          stay.id,
          stay.is_active ? "active" : stay.status === "checked_out" || stay.status === "cancelled" ? "checked_out" : "unknown",
        ]),
      ),
    [hotelStays.data],
  );
  const stayGuestNames = useMemo(
    () => new Map(hotelStays.data.map((stay) => [stay.id, stay.guest_name ?? null])),
    [hotelStays.data],
  );
  const archivedStayIds = useMemo(
    () =>
      new Set(
        hotelStays.data
          .filter((stay) => stay.status === "checked_out" && isArchivedCheckedOutStay(stay.check_out_at))
          .map((stay) => stay.id),
      ),
    [hotelStays.data],
  );
  const filteredThreads = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return prioritizedThreads.filter((thread) => {
      if (modeFilter !== "all" && thread.mode !== modeFilter) {
        return false;
      }

      if (unreadOnly && (thread.unread_count_front ?? 0) <= 0) {
        return false;
      }

      const stayState = resolveThreadStayState(thread, stayStates);
      const stayId = (thread.stay_id ?? thread.stayId ?? "").trim();
      const isArchived = stayId ? archivedStayIds.has(stayId) : false;
      if (stayFilter === "active" && stayState !== "active") {
        return false;
      }

      if (stayFilter === "checked_out" && (stayState !== "checked_out" || isArchived)) {
        return false;
      }

      if (!query) {
        return true;
      }

      const room = resolveRoomLabel(
        thread.room_id,
        thread.room_number,
        thread.room_display_name,
        roomDisplayNames,
      ).toLowerCase();
      const category = (thread.category ?? "").toLowerCase();
      const lang = (thread.guest_language ?? "").toLowerCase();
      const langLabel = formatGuestLanguageLabel(thread.guest_language).toLowerCase();
      const guestName = ((stayGuestNames.get(stayId) ?? "") || "").toLowerCase();
      return (
        room.includes(query) ||
        category.includes(query) ||
        lang.includes(query) ||
        langLabel.includes(query) ||
        guestName.includes(query)
      );
    });
  }, [archivedStayIds, modeFilter, prioritizedThreads, roomDisplayNames, searchQuery, stayFilter, stayGuestNames, stayStates, unreadOnly]);
  const activeThreadCount = useMemo(
    () => prioritizedThreads.filter((thread) => resolveThreadStayState(thread, stayStates) === "active").length,
    [prioritizedThreads, stayStates],
  );
  const checkedOutThreadCount = useMemo(
    () => prioritizedThreads.filter((thread) => resolveThreadStayState(thread, stayStates) === "checked_out").length,
    [prioritizedThreads, stayStates],
  );
  const visibleThreads = useMemo(() => {
    if (stayFilter !== "all") {
      return filteredThreads;
    }

    return filteredThreads.filter((thread) => {
      const stayId = (thread.stay_id ?? thread.stayId ?? "").trim();
      const stayState = resolveThreadStayState(thread, stayStates);
      return stayState !== "checked_out" && (!stayId || !archivedStayIds.has(stayId));
    });
  }, [archivedStayIds, filteredThreads, stayFilter, stayStates]);
  const collapsedCheckedOutThreads = useMemo(
    () =>
      stayFilter === "all"
        ? filteredThreads.filter((thread) => {
            const stayId = (thread.stay_id ?? thread.stayId ?? "").trim();
            return resolveThreadStayState(thread, stayStates) === "checked_out" && (!stayId || !archivedStayIds.has(stayId));
          })
        : [],
    [archivedStayIds, filteredThreads, stayFilter, stayStates],
  );
  const archivedThreads = useMemo(
    () =>
      stayFilter === "all"
        ? filteredThreads.filter((thread) => {
            const stayId = (thread.stay_id ?? thread.stayId ?? "").trim();
            return Boolean(stayId && archivedStayIds.has(stayId));
          })
        : [],
    [archivedStayIds, filteredThreads, stayFilter],
  );
  const selectedThread = useMemo(() => {
    const explicitSelection = filteredThreads.find((thread) => thread.id === selectedThreadId);
    if (explicitSelection) {
      return explicitSelection;
    }

    if (requestedThreadId) {
      return filteredThreads.find((thread) => thread.id === requestedThreadId) ?? null;
    }

    if (requestedStayId) {
      return filteredThreads.find((thread) => (thread.stay_id ?? thread.stayId ?? "") === requestedStayId) ?? null;
    }

    return filteredThreads[0] ?? null;
  }, [filteredThreads, requestedStayId, requestedThreadId, selectedThreadId]);
  const relatedThreads = useMemo(() => {
    if (!selectedThread) {
      return [];
    }

    const stayId = (selectedThread.stay_id ?? selectedThread.stayId ?? "").trim();
    if (!stayId) {
      return [];
    }

    return prioritizedThreads.filter(
      (thread) =>
        thread.id !== selectedThread.id &&
        (thread.stay_id ?? thread.stayId ?? "").trim() === stayId,
    );
  }, [prioritizedThreads, selectedThread]);
  const effectiveSelectedThreadId = selectedThread?.id ?? "";
  const threadMessages = useThreadMessages(effectiveSelectedThreadId);
  const selectedThreadMessages = useMemo(
    () => (selectedThread ? threadMessages.data : []),
    [selectedThread, threadMessages.data],
  );
  const hasConnectionContext = Boolean(hotelId && staffUserId && canOperate);
  const requestedStayHasThread = Boolean(
    requestedStayId && filteredThreads.some((thread) => (thread.stay_id ?? thread.stayId ?? "") === requestedStayId),
  );
  const selectedRoomLabel = selectedThread
    ? resolveRoomLabel(
        selectedThread.room_id,
        selectedThread.room_number,
        selectedThread.room_display_name,
        roomDisplayNames,
      )
    : "";

  useEffect(() => {
    if (!selectedThread || !hasConnectionContext) {
      return;
    }

    const targets = selectedThreadMessages.filter((message) => {
      if (message.sender !== "guest" || message.translation_state !== "fallback") {
        return false;
      }

      if (fallbackTranslations[message.id]) {
        return false;
      }

      if (pendingFallbackTranslationIdsRef.has(message.id)) {
        return false;
      }

      return Boolean((message.original_body ?? message.body).trim());
    });

    if (targets.length === 0) {
      return;
    }

    for (const message of targets) {
      pendingFallbackTranslationIdsRef.add(message.id);

      void requestTranslationPreview({
        text: (message.original_body ?? message.body).trim(),
        sourceLanguage: message.original_language || selectedThread.guest_language || "en",
        targetLanguage: "ja",
      })
        .then((translatedText) => {
          const trimmedTranslation = translatedText.trim();
          if (!trimmedTranslation) {
            return;
          }

          setFallbackTranslations((current) => {
            if (current[message.id]) {
              return current;
            }

            return { ...current, [message.id]: trimmedTranslation };
          });
        })
        .catch(() => {
          // Keep UI usable if re-translation fails.
        })
        .finally(() => {
          pendingFallbackTranslationIdsRef.delete(message.id);
        });
    }
  }, [fallbackTranslations, hasConnectionContext, pendingFallbackTranslationIdsRef, selectedThread, selectedThreadMessages]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const shouldAlert = prioritizedThreads.some((thread) => {
      if (!isEmergencyThread(thread) || (thread.unread_count_front ?? 0) <= 0) {
        return false;
      }

      if (emergencyAlertThreadIdsRef.has(thread.id)) {
        return false;
      }

      emergencyAlertThreadIdsRef.add(thread.id);
      return true;
    });

    if (shouldAlert) {
      playEmergencyAlertTone();
    }
  }, [emergencyAlertThreadIdsRef, prioritizedThreads]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!("Notification" in window) || Notification.permission !== "granted") {
      return;
    }

    if (window.localStorage.getItem(FRONTDESK_NOTIFICATION_ENABLED_KEY) === "false") {
      return;
    }

    if (pushNotifications.isSubscribed) {
      return;
    }

    for (const thread of prioritizedThreads) {
      if ((thread.unread_count_front ?? 0) <= 0 || notifiedThreadIdsRef.has(thread.id)) {
        continue;
      }

      notifiedThreadIdsRef.add(thread.id);
      new Notification(isEmergencyThread(thread) ? `緊急: ${resolveEmergencyLabel(thread.category)}` : "新しいフロント対応チャット", {
        body: `${resolveRoomLabel(thread.room_id, thread.room_number, thread.room_display_name, roomDisplayNames)} / ${thread.last_message_body ?? thread.category ?? "新着メッセージ"}`,
      });
    }
  }, [notifiedThreadIdsRef, prioritizedThreads, pushNotifications.isSubscribed, roomDisplayNames]);

  useEffect(() => {
    if (!hasConnectionContext || !pushNotifications.isSubscribed || !user) {
      return;
    }

    for (const thread of prioritizedThreads) {
      if (
        (thread.unread_count_front ?? 0) <= 0 ||
        (thread.last_message_sender !== "guest" && thread.last_message_sender !== "ai")
      ) {
        continue;
      }

      const dispatchKey = resolveThreadDispatchKey(thread);
      if (!dispatchKey || notifiedDispatchKeysRef.has(dispatchKey)) {
        continue;
      }

      notifiedDispatchKeysRef.add(dispatchKey);

      void user.getIdToken().then(async (token) => {
        const response = await fetch("/api/frontdesk/push-notifications", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            dispatchKey,
            threadId: thread.id,
          }),
        });

        if (!response.ok) {
          notifiedDispatchKeysRef.delete(dispatchKey);
        }
      }).catch(() => {
        notifiedDispatchKeysRef.delete(dispatchKey);
      });
    }
  }, [hasConnectionContext, notifiedDispatchKeysRef, prioritizedThreads, pushNotifications.isSubscribed, user]);

  useEffect(() => {
    if (!selectedThread || !hasConnectionContext) {
      return;
    }

    if ((selectedThread.unread_count_front ?? 0) <= 0) {
      return;
    }

    void markThreadSeenByFront(selectedThread.id);
  }, [hasConnectionContext, selectedThread]);

  useEffect(() => {
    if (!selectedThread || !hasConnectionContext) {
      return;
    }

    if ((selectedThread.unread_count_front ?? 0) <= 0) {
      return;
    }

    const unreadGuestMessageIds = selectedThreadMessages
      .filter((message) => {
        if (message.sender !== "guest") {
          return false;
        }

        return !(
          message.read_at_guest ||
          message.readAtGuest ||
          message.read_at ||
          message.readAt ||
          message.seen_at_guest ||
          message.seenAtGuest
        );
      })
      .map((message) => message.id);

    if (unreadGuestMessageIds.length === 0) {
      return;
    }

    void markGuestMessagesRead(selectedThread.id, unreadGuestMessageIds).catch(() => {
      // Ignore guest read sync failures here; the thread remains usable and can retry on next open.
    });
  }, [hasConnectionContext, selectedThread, selectedThreadMessages]);

  if (authLoading) {
    return <FrontdeskAuthLoading title="管理画面ログイン" />;
  }

  if (!user) {
    return (
      <HotelAuthCard
        authError={authError}
        description="登録済みのメールアドレスとパスワードでログインしてください"
        isLoading={authLoading}
        onSubmit={login}
        title="管理画面ログイン"
      />
    );
  }

  async function runAction(action: () => Promise<void>, successMessage: string) {
    setActionState(null);

    startUiTransition(async () => {
      try {
        await action();
        setActionState({ kind: "success", message: successMessage });
      } catch (error) {
        setActionState({
          kind: "error",
          message: error instanceof Error ? error.message : "unknown-error",
        });
      }
    });
  }

  function handleSelectThread(threadId: string) {
    startTransition(() => {
      setSelectedThreadId(threadId);
      setMobilePane("chat");
      setDraftMessage("");
      setActionState(null);
    });
  }

  async function handleLogout() {
    if (pushNotifications.isSubscribed) {
      await pushNotifications.disable();
    }

    await logout();
  }

  return (
    <FrontdeskShell
      compactMode={compactMode}
      pageSubtitle="問い合わせ確認と返信をまとめて行えます"
      pageTitle="チャット"
      onLogout={() => void handleLogout()}
      role={role}
      variant="messenger"
    >
      {!canOperate ? (
        <div className="mx-3 mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm sm:mx-6 lg:mx-6">
          このアカウントには `hotel_front` または `hotel_admin` の custom claim が必要です 現在の role: {role ?? "未設定"}
        </div>
      ) : null}

      {actionState ? (
        <div
          className={`mx-3 mt-3 rounded-2xl border px-4 py-3 text-sm shadow-sm sm:mx-6 lg:mx-6 ${
            actionState.kind === "success"
              ? "border-[#e7c0bb] bg-[#fff1ef] text-[#ad2218]"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          {actionState.message}
        </div>
      ) : null}

      {canOperate ? (
        <div className="mx-3 mt-3 rounded-2xl border border-[#e7c0bb] bg-[#fff5f4] px-4 py-3 text-sm text-stone-700 shadow-sm sm:mx-6 lg:mx-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-stone-900">Web Push 通知</p>
              <p className="mt-1 text-xs leading-5 text-stone-500">
                {pushNotifications.permission === "denied"
                  ? "ブラウザで通知が拒否されています。Chrome のサイト設定から通知を許可してください。"
                  : pushNotifications.isSubscribed
                    ? "バックグラウンドでも新着チャット通知を受け取る設定です。"
                    : "Chrome を閉じ気味でも拾えるように、FCM Web Push を有効化してください。"}
              </p>
              {pushNotifications.error ? (
                <p className="mt-2 text-xs text-rose-700">{pushNotifications.error}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {pushNotifications.isSubscribed ? (
                <button
                  type="button"
                  className="rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void pushNotifications.disable()}
                  disabled={pushNotifications.isLoading}
                >
                  {pushNotifications.isLoading ? "解除中..." : "通知を解除"}
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-full bg-[#ad2218] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-stone-300"
                  onClick={() => void pushNotifications.enable()}
                  disabled={pushNotifications.isLoading || !pushNotifications.isSupported}
                >
                  {pushNotifications.isLoading ? "設定中..." : "通知を有効化"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className={`px-3 pb-3 sm:px-6 lg:hidden ${compactMode ? "pt-3" : "pt-5"}`}>
        <div className="flex rounded-[8px] bg-white p-1 shadow-[0_10px_24px_rgba(72,32,28,0.08)]">
          <button
            type="button"
            className={`flex-1 rounded-[6px] px-4 py-3 text-sm font-semibold transition ${
              mobilePane === "list" ? "bg-[#ad2218] text-white" : "text-stone-500"
            }`}
            onClick={() => setMobilePane("list")}
          >
            一覧
          </button>
          <button
            type="button"
            className={`flex-1 rounded-[6px] px-4 py-3 text-sm font-semibold transition ${
              mobilePane === "chat" ? "bg-[#ad2218] text-white" : "text-stone-500"
            }`}
            onClick={() => setMobilePane("chat")}
            disabled={!selectedThread}
          >
            会話
          </button>
        </div>
      </div>

      <div className={`grid min-h-[calc(100dvh-182px)] px-3 pb-3 sm:px-6 lg:min-h-[calc(100vh-88px)] lg:grid-cols-[360px_minmax(0,1fr)] lg:px-6 xl:grid-cols-[390px_minmax(0,1fr)] ${compactMode ? "gap-2 pt-1 sm:pt-2 lg:gap-3 lg:pt-3" : "gap-3 pt-2 sm:pt-3 lg:gap-4 lg:pt-5"}`}>
        <aside id="priority" className={`${mobilePane === "chat" ? "hidden" : "block"} lg:block`}>
          <div className="overflow-hidden rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] shadow-[0_12px_30px_rgba(72,32,28,0.06)]">
            <div className="border-b border-[#ecd2cf] bg-white px-4 py-4 sm:px-5 lg:px-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-stone-950 sm:text-xl">トーク一覧</h2>
                  <p className="text-sm text-stone-500">
                    {resolveStayFilterLabel(stayFilter)} / 新着 {threadSummary.newCount} 件 / 緊急 {threadSummary.emergencyCount} 件
                  </p>
                </div>
                <span className="rounded-full bg-[#fff1ef] px-3 py-1 text-xs font-semibold text-[#ad2218]">
                  {filteredThreads.length}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {(["active", "checked_out", "all"] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      stayFilter === filter
                        ? "bg-[#ad2218] text-white"
                        : "border border-[#e7d5d1] bg-white text-stone-600 hover:border-[#d8aaa4] hover:bg-[#fff3f1]"
                    }`}
                    onClick={() => setStayFilter(filter)}
                  >
                    {resolveStayFilterLabel(filter)}
                    <span className="ml-1 opacity-80">
                      {filter === "active" ? activeThreadCount : filter === "checked_out" ? checkedOutThreadCount : prioritizedThreads.length}
                    </span>
                  </button>
                ))}
                {(["all", "ai", "human"] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      modeFilter === filter
                        ? "bg-stone-950 text-white"
                        : "border border-[#e7d5d1] bg-white text-stone-600 hover:border-[#d8aaa4] hover:bg-[#fff3f1]"
                    }`}
                    onClick={() => setModeFilter(filter)}
                  >
                    {filter === "all" ? "すべて" : filter === "ai" ? "AI" : "Staff"}
                  </button>
                ))}
                <button
                  type="button"
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    unreadOnly
                      ? "bg-stone-950 text-white"
                      : "border border-[#e7d5d1] bg-white text-stone-600 hover:border-[#d8aaa4] hover:bg-[#fff3f1]"
                  }`}
                  onClick={() => setUnreadOnly((current) => !current)}
                >
                  未読のみ
                </button>
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-full bg-[#fff3f1] px-4 py-3">
                <span className="text-stone-400">🔎</span>
                <input
                  className="w-full bg-transparent text-sm outline-none placeholder:text-stone-400"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="部屋番号や内容で検索"
                />
              </div>
            </div>

            <div className={`overflow-y-auto lg:max-h-[calc(100vh-180px)] ${compactMode ? "space-y-2 p-2.5 lg:p-3" : "space-y-3 p-3 lg:p-4"}`}>
              {recentThreads.isLoading ? <p className="text-sm text-stone-500">一覧を読み込み中です</p> : null}
              {recentThreads.error ? <p className="text-sm text-rose-700">{recentThreads.error}</p> : null}

              {visibleThreads.map((thread) => (
                <ThreadListCard
                  key={thread.id}
                  thread={thread}
                  guestName={stayGuestNames.get((thread.stay_id ?? thread.stayId ?? "").trim()) ?? null}
                  roomLabel={resolveRoomLabel(
                    thread.room_id,
                    thread.room_number,
                    thread.room_display_name,
                    roomDisplayNames,
                  )}
                  isSelected={selectedThread?.id === thread.id}
                  selectedByOther={
                    thread.status === "in_progress" && Boolean(thread.assigned_to && thread.assigned_to !== staffUserId)
                  }
                  stayState={resolveThreadStayState(thread, stayStates)}
                  onClick={() => handleSelectThread(thread.id)}
                />
              ))}

              {stayFilter === "all" && collapsedCheckedOutThreads.length > 0 ? (
                <div className="rounded-[8px] border border-[#ead8d5] bg-white">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                    onClick={() => setCheckedOutCollapsed((current) => !current)}
                  >
                    <span className="text-sm font-semibold text-stone-900">済み {collapsedCheckedOutThreads.length}</span>
                    <span className="text-xs text-stone-500">{checkedOutCollapsed ? "展開" : "折りたたむ"}</span>
                  </button>
                  {!checkedOutCollapsed ? (
                    <div className={`border-t border-[#f1e5e3] ${compactMode ? "space-y-2 p-2.5" : "space-y-3 p-3"}`}>
                      {collapsedCheckedOutThreads.map((thread) => (
                        <ThreadListCard
                          key={thread.id}
                          thread={thread}
                          guestName={stayGuestNames.get((thread.stay_id ?? thread.stayId ?? "").trim()) ?? null}
                          roomLabel={resolveRoomLabel(
                            thread.room_id,
                            thread.room_number,
                            thread.room_display_name,
                            roomDisplayNames,
                          )}
                          isSelected={selectedThread?.id === thread.id}
                          selectedByOther={
                            thread.status === "in_progress" && Boolean(thread.assigned_to && thread.assigned_to !== staffUserId)
                          }
                          stayState={resolveThreadStayState(thread, stayStates)}
                          onClick={() => handleSelectThread(thread.id)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {stayFilter === "all" && archivedThreads.length > 0 ? (
                <div className="rounded-[8px] border border-[#ead8d5] bg-white">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                    onClick={() => setArchivedCollapsed((current) => !current)}
                  >
                    <span className="text-sm font-semibold text-stone-900">アーカイブ {archivedThreads.length}</span>
                    <span className="text-xs text-stone-500">{archivedCollapsed ? "展開" : "折りたたむ"}</span>
                  </button>
                  {!archivedCollapsed ? (
                    <div className={`border-t border-[#f1e5e3] ${compactMode ? "space-y-2 p-2.5" : "space-y-3 p-3"}`}>
                      {archivedThreads.map((thread) => (
                        <ThreadListCard
                          key={thread.id}
                          thread={thread}
                          guestName={stayGuestNames.get((thread.stay_id ?? thread.stayId ?? "").trim()) ?? null}
                          roomLabel={resolveRoomLabel(
                            thread.room_id,
                            thread.room_number,
                            thread.room_display_name,
                            roomDisplayNames,
                          )}
                          isSelected={selectedThread?.id === thread.id}
                          selectedByOther={
                            thread.status === "in_progress" && Boolean(thread.assigned_to && thread.assigned_to !== staffUserId)
                          }
                          stayState={resolveThreadStayState(thread, stayStates)}
                          onClick={() => handleSelectThread(thread.id)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {!recentThreads.isLoading && filteredThreads.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[#ecd2cf] bg-white px-4 py-5 text-sm text-stone-500">
                  {requestedStayId && !requestedStayHasThread
                    ? "この滞在にはまだチャットがありません"
                    : "トークはまだありません"}
                </p>
              ) : null}
            </div>
          </div>
        </aside>

        <section id="detail" className={`${mobilePane === "list" ? "hidden" : "block"} lg:block`}>
          <div className="flex h-full flex-col overflow-hidden rounded-[8px] border border-[#ecd2cf] bg-white shadow-[0_12px_30px_rgba(72,32,28,0.06)]">
            <div className="border-b border-[#ecd2cf] bg-white px-4 py-4 sm:px-6 lg:px-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 lg:flex-1">
                  <button
                    type="button"
                    className="mb-3 rounded-full border border-stone-200 px-3 py-1.5 text-sm text-stone-600 lg:hidden"
                    onClick={() => setMobilePane("list")}
                  >
                    一覧へ戻る
                  </button>
                  <div className="flex items-center gap-3">
                    {selectedThread ? (
                      <div className="grid h-12 w-12 place-items-center rounded-full bg-[#ad2218] text-lg font-semibold text-white">
                        {selectedRoomLabel.slice(0, 1) || "客"}
                      </div>
                    ) : null}
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold text-stone-950">
                        {selectedThread ? selectedRoomLabel : "スレッド未選択"}
                      </h2>
                      {selectedThread ? (
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                          {isEmergencyCategory(selectedThread.category) ? (
                            <span className="rounded-full bg-[#ad2218] px-2 py-1 font-semibold text-white">
                              {resolveEmergencyLabel(selectedThread.category)}
                            </span>
                          ) : null}
                          <span className={`rounded-full px-2 py-1 font-semibold ${
                            selectedThread.mode === "ai" ? "bg-[#f2e8ff] text-[#6c3baa]" : "bg-[#fff1ef] text-[#ad2218]"
                          }`}>
                            {resolveModeLabel(selectedThread.mode)}
                          </span>
                          <span>{formatSenderLabel(selectedThread.last_message_sender ?? "system")}</span>
                          <span>{formatTime(selectedThread.last_message_at ?? selectedThread.updated_at)}</span>
                          {stayGuestNames.get((selectedThread.stay_id ?? selectedThread.stayId ?? "").trim()) ? (
                            <span>
                              {stayGuestNames.get((selectedThread.stay_id ?? selectedThread.stayId ?? "").trim())}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {!selectedThread ? (
                        <p className="mt-1 truncate text-xs text-stone-500">左の一覧から問い合わせを選択してください</p>
                      ) : null}
                    </div>
                  </div>
                </div>

              </div>
            </div>

            <div className="flex min-h-[calc(100dvh-318px)] flex-col lg:min-h-[calc(100vh-210px)]">
              <div className={`flex-1 overflow-y-auto bg-white sm:px-5 lg:px-6 ${compactMode ? "space-y-3 px-4 py-4 lg:py-4" : "space-y-4 px-4 py-5 lg:py-6"}`}>
                <div className="flex items-center justify-between gap-3 lg:hidden">
                  <button
                    type="button"
                    className="rounded-full border border-stone-200 px-3 py-1.5 text-sm text-stone-600"
                    onClick={() => setMobilePane("list")}
                  >
                    一覧へ戻る
                  </button>
                </div>
                {selectedThreadId && threadMessages.isLoading ? (
                  <p className="text-sm text-stone-500">メッセージを読み込み中です</p>
                ) : null}
                {threadMessages.error ? <p className="text-sm text-rose-500">{threadMessages.error}</p> : null}
                {!selectedThread ? (
                  <div className="rounded-[8px] border border-dashed border-[#e6c8c4] bg-white/80 px-4 py-8 text-center text-sm text-stone-500">
                    左のトーク一覧から問い合わせを選択すると会話が表示されます
                  </div>
                ) : null}
                {selectedThread && selectedThreadMessages.length === 0 && !threadMessages.isLoading ? (
                  <div className="rounded-[8px] border border-dashed border-[#e6c8c4] bg-white/80 px-4 py-8 text-center text-sm text-stone-500">
                    まだメッセージがありません
                  </div>
                ) : null}
                {selectedThread && isEmergencyCategory(selectedThread.category) ? (
                  <div className="rounded-[8px] border border-[#efb8b2] bg-[#fff3f1] px-4 py-3 text-sm text-[#7d2a22]">
                    <p className="font-semibold">緊急カテゴリ: {resolveEmergencyLabel(selectedThread.category)}</p>
                    <p className="mt-1 text-xs text-[#9a4036]">
                      通常問い合わせより優先して確認してください。push 受信後もこのスレッドを最優先で扱います。
                    </p>
                  </div>
                ) : null}
                {selectedThread && relatedThreads.length > 0 ? (
                  <div className="rounded-[8px] border border-[#ead8d5] bg-[#fff8f7] px-4 py-3 text-sm text-stone-700">
                    <p className="font-semibold text-stone-900">
                      {selectedThread.mode === "ai" ? "関連する Staff スレッド" : "関連する AI スレッド"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {relatedThreads.map((thread) => (
                        <button
                          key={thread.id}
                          type="button"
                          className="rounded-full border border-[#e7d5d1] bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:border-[#d8aaa4] hover:bg-[#fff3f1]"
                          onClick={() => handleSelectThread(thread.id)}
                        >
                          {resolveModeLabel(thread.mode)} / {formatTime(thread.last_message_at ?? thread.updated_at)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedThreadMessages.map((message) => {
                  const isFront = message.sender === "front";
                  const displayBody = resolveFrontMessageBody(message);
                  const meta = resolveMessageMeta(message);

                  return (
                    <article key={message.id} className={`flex ${isFront ? "justify-end" : "justify-start"}`}>
                      <div className="max-w-[94%] sm:max-w-[82%] xl:max-w-[68%]">
                        <div
                          className={`rounded-[8px] px-4 py-3 shadow-sm ${
                            isFront
                            ? "bg-[#f4c7c2] text-stone-900"
                            : "border border-[#ecd2cf] bg-white text-stone-900"
                          }`}
                        >
                          <div className="mb-1 text-[11px] text-stone-500">{formatSenderLabel(message.sender)}</div>
                          <p className="whitespace-pre-wrap text-[15px] leading-6">{displayBody}</p>
                          {message.image_url ? (
                            <div className="mt-3 overflow-hidden rounded-[6px] border border-black/5 bg-black/5">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={message.image_url}
                                alt={message.image_alt || "チャット添付画像"}
                                className="max-h-72 w-full object-cover"
                              />
                            </div>
                          ) : null}
                          {meta.originalBody ? (
                            <div className="mt-2 rounded-[6px] bg-black/5 px-3 py-2 text-xs leading-5 text-stone-600">
                              <div className="font-semibold text-stone-500">
                                原文{meta.languageLabel ? ` (${meta.languageLabel})` : ""}
                              </div>
                              <p className="mt-1 whitespace-pre-wrap">{meta.originalBody}</p>
                            </div>
                          ) : null}
                          {meta.translatedGuestBody ? (
                            <div className="mt-2 rounded-[6px] bg-black/5 px-3 py-2 text-xs leading-5 text-stone-600">
                              <div className="font-semibold text-stone-500">
                                ゲスト向け翻訳{meta.languageLabel ? ` (${meta.languageLabel})` : ""}
                              </div>
                              <p className="mt-1 whitespace-pre-wrap">{meta.translatedGuestBody}</p>
                            </div>
                          ) : null}
                          {meta.translationState === "fallback" ? (
                            <div className="mt-2 text-xs font-semibold text-amber-700">
                              {fallbackTranslations[message.id] || "翻訳確認推奨"}
                            </div>
                          ) : null}
                        </div>
                        <div className={`mt-1 px-1 text-[11px] text-stone-400 ${isFront ? "text-right" : "text-left"}`}>
                          {formatTime(message.timestamp)}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className={`border-t border-[#ecd2cf] bg-white px-4 sm:px-6 lg:px-6 ${compactMode ? "py-2.5" : "py-3"}`}>
                <div className={`mb-2 ${selectedThread ? "block" : "hidden"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                    {availableReplyTemplates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className="rounded-full border border-[#ecd2cf] bg-[#fff8f7] px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:border-[#d8aaa4] hover:bg-[#fff1ef]"
                        onClick={() => {
                          setSelectedTemplate(template.label);
                          setDraftMessage((current) => (current.trim() ? `${current.trim()}\n${template.body}` : template.body));
                        }}
                      >
                        {template.label}
                      </button>
                    ))}
                    </div>
                    <Link
                      href="/settings#reply-templates"
                      className="text-xs font-semibold text-[#ad2218] transition hover:opacity-80"
                    >
                      テンプレートを編集
                    </Link>
                  </div>
                  {replyTemplatesState.error ? (
                    <p className="mt-2 text-xs text-rose-600">テンプレートの取得に失敗しました: {replyTemplatesState.error}</p>
                  ) : null}
                  {availableReplyTemplates.length === 0 ? (
                    <p className="mt-2 text-xs text-stone-500">設定画面で返信テンプレートを追加できます</p>
                  ) : selectedTemplate ? (
                    <p className="mt-2 text-xs text-stone-500">テンプレ: {selectedTemplate}</p>
                  ) : null}
                </div>
                {selectedThread?.mode === "ai" ? (
                  <p className="mb-2 text-xs text-stone-500">
                    AI 対応スレッドは閲覧専用です。human に引き継がれた後にスタッフ返信できます。
                  </p>
                ) : null}
                <div className="flex items-end gap-3">
                  <textarea
                    rows={1}
                    className="h-12 flex-1 resize-none rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] px-4 py-3 text-base leading-6 text-stone-900 outline-none transition focus:border-[#ad2218]"
                    value={draftMessage}
                    onChange={(event) => setDraftMessage(event.target.value)}
                    placeholder="メッセージを入力"
                    disabled={!selectedThread || selectedThread.mode === "ai"}
                  />
                  <button
                    type="button"
                    className="grid h-12 min-w-12 shrink-0 place-items-center rounded-[8px] bg-[#ad2218] px-4 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(173,34,24,0.22)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:shadow-none sm:min-w-24"
                    disabled={!selectedThread || selectedThread.mode === "ai" || !hasConnectionContext || isPending || !draftMessage.trim()}
                    onClick={() =>
                      selectedThread &&
                      (() => {
                        setSelectedThreadId(selectedThread.id);
                        void runAction(async () => {
                          await sendFrontMessage(selectedThread.id, staffUserId, draftMessage);
                          setDraftMessage("");
                        }, `${resolveRoomLabel(
                          selectedThread.room_id,
                          selectedThread.room_number,
                          selectedThread.room_display_name,
                          roomDisplayNames,
                        )} に返信しました`);
                      })()
                    }
                  >
                    <span className="hidden sm:inline">送信</span>
                    <span className="sm:hidden">送信</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </FrontdeskShell>
  );
}
