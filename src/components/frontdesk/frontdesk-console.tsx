"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { HotelAuthCard } from "@/components/auth/hotel-auth-card";
import { FrontdeskAuthLoading } from "@/components/frontdesk/frontdesk-auth-loading";
import { FrontdeskShell } from "@/components/frontdesk/frontdesk-shell";
import {
  markThreadSeenByFront,
  requestTranslationPreview,
  sendFrontMessage,
} from "@/lib/frontdesk/firestore";
import { formatGuestLanguageLabel } from "@/lib/frontdesk/languages";
import {
  formatRoomLabel,
  formatSenderLabel,
  formatThreadInquiryType,
  formatTime,
} from "@/lib/frontdesk/format";
import type { ChatThreadRecord, MessageRecord } from "@/lib/frontdesk/types";
import { useHotelRooms, useHotelStays, useRecentThreads, useStayMessages, useThreadMessages } from "@/hooks/useFrontdeskData";
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

type ThreadGroup = {
  id: string;
  stayId: string;
  primaryThread: ChatThreadRecord;
  replyThread: ChatThreadRecord | null;
  threads: ChatThreadRecord[];
  unreadCountFront: number;
  hasAiThread: boolean;
  hasHumanThread: boolean;
};

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

function shouldHideFrontdeskMessage(message: MessageRecord) {
  if (message.sender !== "system") {
    return false;
  }

  const body = (message.body ?? "").trim();
  return body === "The front desk has been notified. Please wait for a reply.";
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

function resolveReplyThread(threads: ChatThreadRecord[]) {
  return threads.find((thread) => thread.mode === "human" && thread.status !== "resolved") ?? null;
}

function isAssignedToOtherStaff(thread: ChatThreadRecord | null, staffUserId: string) {
  if (!thread || !staffUserId) {
    return false;
  }

  return thread.status === "in_progress" && Boolean(thread.assigned_to && thread.assigned_to !== staffUserId);
}

function ThreadListCard({
  thread,
  guestName,
  roomLabel,
  isSelected,
  selectedByOther,
  stayState,
  unreadCountFront,
  onClick,
}: {
  thread: ChatThreadRecord;
  guestName?: string | null;
  roomLabel: string;
  isSelected: boolean;
  selectedByOther: boolean;
  stayState: "active" | "checked_out" | "unknown";
  unreadCountFront: number;
  onClick: () => void;
}) {
  const roomInitial = roomLabel.slice(0, 1) || "客";
  const headline = guestName ? `${roomLabel}/${guestName}様` : roomLabel;

  return (
    <button
      type="button"
      className={`w-full rounded-[8px] border px-4 py-3.5 text-left transition ${
        isEmergencyThread(thread)
          ? isSelected
            ? "border-[#c33b2b] bg-[#fff1ef]"
            : "border-[#efb8b2] bg-[#fff8f7] hover:border-[#d95e52] hover:bg-[#fff1ef]"
          : isSelected
            ? "border-[#e1b8b3] bg-[#fff4f2]"
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
          <h3 className="truncate text-[15px] font-semibold text-stone-950">{headline}</h3>
          <p className="mt-1 line-clamp-1 text-sm text-stone-500">
            {thread.last_message_body ?? thread.category ?? formatThreadInquiryType(thread)}
          </p>
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-stone-400">
            <div className="flex flex-wrap items-center gap-2">
              {selectedByOther ? <span>他スタッフ対応中</span> : null}
              {stayState === "checked_out" ? <span>チェックアウト済み</span> : null}
            </div>
            {unreadCountFront > 0 ? (
              <span className="block h-2.5 w-2.5 rounded-full bg-[#ad2218]" aria-label="未読あり" />
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
  const [isPending, startUiTransition] = useTransition();
  const pendingFallbackTranslationIdsRef = useState(() => new Set<string>())[0];
  const emergencyAlertThreadIdsRef = useState(() => new Set<string>())[0];
  const [compactMode] = useCompactModePreference();
  const role = claims?.role;
  const canOperate = role === "hotel_front" || role === "hotel_admin";
  const pushNotifications = useFrontdeskPushNotifications({
    enabled: canOperate,
    user,
  });

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
  const stayGuestLanguages = useMemo(
    () => new Map(hotelStays.data.map((stay) => [stay.id, stay.guest_language ?? ""])),
    [hotelStays.data],
  );
  const groupedThreads = useMemo<ThreadGroup[]>(() => {
    const groups = new Map<string, ChatThreadRecord[]>();

    for (const thread of prioritizedThreads) {
      const stayId = (thread.stay_id ?? thread.stayId ?? "").trim();
      const key = stayId || `thread:${thread.id}`;
      const current = groups.get(key) ?? [];
      current.push(thread);
      groups.set(key, current);
    }

    return Array.from(groups.entries())
      .map(([key, threads]) => {
        const sortedThreads = sortByPriority(threads);
        const primaryThread = sortedThreads[0];

        return {
          id: key,
          stayId: (primaryThread.stay_id ?? primaryThread.stayId ?? "").trim(),
          primaryThread,
          replyThread: resolveReplyThread(sortedThreads),
          threads: sortedThreads,
          unreadCountFront: sortedThreads.reduce((sum, thread) => sum + (thread.unread_count_front ?? 0), 0),
          hasAiThread: sortedThreads.some((thread) => thread.mode === "ai"),
          hasHumanThread: sortedThreads.some((thread) => thread.mode === "human"),
        };
      })
      .sort((left, right) => {
        const priorityDiff = priorityValue(left.primaryThread) - priorityValue(right.primaryThread);
        if (priorityDiff !== 0) {
          return priorityDiff;
        }

        const rightLastMessageAt = toMillis(right.primaryThread.last_message_at);
        const leftLastMessageAt = toMillis(left.primaryThread.last_message_at);

        if (rightLastMessageAt !== leftLastMessageAt) {
          return rightLastMessageAt - leftLastMessageAt;
        }

        return toMillis(right.primaryThread.updated_at) - toMillis(left.primaryThread.updated_at);
      });
  }, [prioritizedThreads]);
  const filteredThreadGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return groupedThreads.filter((group) => {
      const thread = group.primaryThread;
      const stayId = group.stayId;
      const stayState = resolveThreadStayState(thread, stayStates);
      const hasLinkedStay = !stayId || hotelStays.data.some((stay) => stay.id === stayId);

      if (!hasLinkedStay) {
        return false;
      }

      if (stayState === "checked_out") {
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
      const category = group.threads.map((item) => item.category ?? "").join(" ").toLowerCase();
      const groupGuestLanguage =
        stayGuestLanguages.get(stayId) ||
        group.threads.map((item) => item.guest_language ?? "").find((language) => Boolean(language)) ||
        "";
      const lang = groupGuestLanguage.toLowerCase();
      const langLabel = formatGuestLanguageLabel(groupGuestLanguage).toLowerCase();
      const guestName = ((stayGuestNames.get(stayId) ?? "") || "").toLowerCase();
      return (
        room.includes(query) ||
        category.includes(query) ||
        lang.includes(query) ||
        langLabel.includes(query) ||
        guestName.includes(query)
      );
    });
  }, [groupedThreads, hotelStays.data, roomDisplayNames, searchQuery, stayGuestLanguages, stayGuestNames, stayStates]);
  const selectedGroup = useMemo(() => {
    const explicitSelection = filteredThreadGroups.find((group) => group.id === selectedThreadId);
    if (explicitSelection) {
      return explicitSelection;
    }

    if (requestedThreadId) {
      return filteredThreadGroups.find((group) => group.threads.some((thread) => thread.id === requestedThreadId)) ?? null;
    }

    if (requestedStayId) {
      return filteredThreadGroups.find((group) => group.stayId === requestedStayId) ?? null;
    }

    return filteredThreadGroups[0] ?? null;
  }, [filteredThreadGroups, requestedStayId, requestedThreadId, selectedThreadId]);
  const selectedThread = selectedGroup?.primaryThread ?? null;
  const selectedReplyThread = selectedGroup?.replyThread ?? null;
  const selectedStayId = selectedGroup?.stayId ?? "";
  const selectedStayExists = Boolean(selectedStayId && hotelStays.data.some((stay) => stay.id === selectedStayId));
  const effectiveSelectedStayId = selectedStayExists ? selectedStayId : "";
  const shouldUseStayMessages = Boolean(effectiveSelectedStayId);
  const effectiveSelectedThreadId = selectedThread?.id ?? "";
  const threadMessages = useThreadMessages(effectiveSelectedThreadId, !shouldUseStayMessages);
  const stayMessages = useStayMessages(effectiveSelectedStayId, shouldUseStayMessages);
  const selectedThreadMessages = useMemo(
    () => {
      if (!selectedGroup) {
        return [];
      }

      const threadIds = new Set(selectedGroup.threads.map((thread) => thread.id));
      const sourceMessages = shouldUseStayMessages ? stayMessages.data : threadMessages.data;

      return sourceMessages.filter((message) => threadIds.has(message.thread_id) && !shouldHideFrontdeskMessage(message));
    },
    [selectedGroup, shouldUseStayMessages, stayMessages.data, threadMessages.data],
  );
  const selectedMessagesState = shouldUseStayMessages ? stayMessages : threadMessages;
  const hasConnectionContext = Boolean(hotelId && staffUserId && canOperate);
  const requestedStayHasThread = Boolean(
    requestedStayId && filteredThreadGroups.some((group) => group.stayId === requestedStayId),
  );
  const selectedGuestName = selectedStayId ? stayGuestNames.get(selectedStayId) ?? null : null;
  const selectedGuestLanguage =
    (selectedStayId ? stayGuestLanguages.get(selectedStayId) : "") || selectedThread?.guest_language || "en";
  const selectedReplyAssignedToOther = isAssignedToOtherStaff(selectedReplyThread, staffUserId);
  const selectedRoomLabel = selectedThread
    ? resolveRoomLabel(
        selectedThread.room_id,
        selectedThread.room_number,
        selectedThread.room_display_name,
        roomDisplayNames,
      )
    : "";

  useEffect(() => {
    if (!selectedGroup || !selectedThread || !hasConnectionContext) {
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
        sourceLanguage: message.original_language || selectedGuestLanguage,
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
  }, [
    fallbackTranslations,
    hasConnectionContext,
    pendingFallbackTranslationIdsRef,
    selectedGroup,
    selectedGuestLanguage,
    selectedThread,
    selectedThreadMessages,
  ]);

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
    if (!selectedGroup || !hasConnectionContext) {
      return;
    }

    const unreadThreads = selectedGroup.threads.filter((thread) => (thread.unread_count_front ?? 0) > 0);
    if (unreadThreads.length === 0) {
      return;
    }

    unreadThreads.forEach((thread) => {
      void markThreadSeenByFront(thread.id);
    });
  }, [hasConnectionContext, selectedGroup]);

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
              {pushNotifications.debugMessage ? (
                <p className="mt-2 text-xs text-emerald-700">登録デバッグ: {pushNotifications.debugMessage}</p>
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

      <div className={`grid min-h-0 flex-1 px-3 pb-3 sm:px-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:px-6 xl:grid-cols-[390px_minmax(0,1fr)] ${compactMode ? "gap-2 pt-1 sm:pt-2 lg:gap-3 lg:pt-3" : "gap-3 pt-2 sm:pt-3 lg:gap-4 lg:pt-5"}`}>
        <aside id="priority" className={`min-h-0 ${mobilePane === "chat" ? "hidden" : "block"} lg:block`}>
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] shadow-[0_12px_30px_rgba(72,32,28,0.06)]">
            <div className="shrink-0 border-b border-[#ecd2cf] bg-white px-4 py-4 sm:px-5 lg:px-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-stone-950 sm:text-xl">トーク一覧</h2>
                  <p className="text-sm text-stone-500">
                    新着 {threadSummary.newCount} / 緊急 {threadSummary.emergencyCount}
                  </p>
                </div>
                <span className="rounded-full bg-[#fff1ef] px-3 py-1 text-xs font-semibold text-[#ad2218]">
                  {filteredThreadGroups.length}
                </span>
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

            <div className={`min-h-0 flex-1 overflow-y-auto ${compactMode ? "space-y-2 p-2.5 lg:p-3" : "space-y-3 p-3 lg:p-4"}`}>
              {recentThreads.isLoading ? <p className="text-sm text-stone-500">一覧を読み込み中です</p> : null}
              {recentThreads.error ? <p className="text-sm text-rose-700">{recentThreads.error}</p> : null}

              {filteredThreadGroups.map((group) => (
                <ThreadListCard
                  key={group.id}
                  thread={group.primaryThread}
                  guestName={stayGuestNames.get(group.stayId) ?? null}
                  roomLabel={resolveRoomLabel(
                    group.primaryThread.room_id,
                    group.primaryThread.room_number,
                    group.primaryThread.room_display_name,
                    roomDisplayNames,
                  )}
                  isSelected={selectedGroup?.id === group.id}
                  selectedByOther={
                    isAssignedToOtherStaff(group.replyThread, staffUserId)
                  }
                  stayState={resolveThreadStayState(group.primaryThread, stayStates)}
                  unreadCountFront={group.unreadCountFront}
                  onClick={() => handleSelectThread(group.id)}
                />
              ))}

              {!recentThreads.isLoading && filteredThreadGroups.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[#ecd2cf] bg-white px-4 py-5 text-sm text-stone-500">
                  {requestedStayId && !requestedStayHasThread
                    ? "この滞在にはまだチャットがありません"
                    : "トークはまだありません"}
                </p>
              ) : null}
            </div>
          </div>
        </aside>

        <section id="detail" className={`min-h-0 ${mobilePane === "list" ? "hidden" : "block"} lg:block`}>
          <div className="flex h-full flex-col overflow-hidden rounded-[8px] border border-[#ecd2cf] bg-white shadow-[0_12px_30px_rgba(72,32,28,0.06)]">
            <div className="shrink-0 border-b border-[#ecd2cf] bg-white px-4 py-4 sm:px-6 lg:px-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 lg:flex-1">
                  <button
                    type="button"
                    className="mb-3 rounded-full border border-stone-200 px-3 py-1.5 text-sm text-stone-600 lg:hidden"
                    onClick={() => setMobilePane("list")}
                  >
                    一覧へ戻る
                  </button>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-stone-950">
                      {selectedThread
                        ? selectedGuestName
                          ? `${selectedRoomLabel}/${selectedGuestName}様`
                          : selectedRoomLabel
                        : "スレッド未選択"}
                    </h2>
                    {!selectedThread ? (
                      <p className="mt-1 truncate text-xs text-stone-500">左の一覧から問い合わせを選択してください</p>
                    ) : null}
                  </div>
                </div>

              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className={`min-h-0 flex-1 overflow-y-auto bg-white sm:px-5 lg:px-6 ${compactMode ? "space-y-3 px-4 py-4 lg:py-4" : "space-y-4 px-4 py-5 lg:py-6"}`}>
                <div className="flex items-center justify-between gap-3 lg:hidden">
                  <button
                    type="button"
                    className="rounded-full border border-stone-200 px-3 py-1.5 text-sm text-stone-600"
                    onClick={() => setMobilePane("list")}
                  >
                    一覧へ戻る
                  </button>
                </div>
                {selectedThreadId && selectedMessagesState.isLoading ? (
                  <p className="text-sm text-stone-500">メッセージを読み込み中です</p>
                ) : null}
                {selectedMessagesState.error ? <p className="text-sm text-rose-500">{selectedMessagesState.error}</p> : null}
                {!selectedThread ? (
                  <div className="rounded-[8px] border border-dashed border-[#e6c8c4] bg-white/80 px-4 py-8 text-center text-sm text-stone-500">
                    左のトーク一覧から問い合わせを選択すると会話が表示されます
                  </div>
                ) : null}
                {selectedThread && selectedThreadMessages.length === 0 && !selectedMessagesState.isLoading ? (
                  <div className="px-4 py-8 text-center text-sm text-stone-500">
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
                <div className="flex items-end gap-3">
                  <textarea
                    rows={1}
                    className="h-12 flex-1 resize-none rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] px-4 py-3 text-base leading-6 text-stone-900 outline-none transition focus:border-[#ad2218]"
                    value={draftMessage}
                    onChange={(event) => setDraftMessage(event.target.value)}
                    placeholder="メッセージを入力"
                    disabled={!selectedReplyThread || selectedReplyAssignedToOther}
                  />
                  <button
                    type="button"
                    className="grid h-12 min-w-12 shrink-0 place-items-center rounded-[8px] bg-[#ad2218] px-4 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(173,34,24,0.22)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:shadow-none sm:min-w-24"
                    disabled={
                      !selectedReplyThread ||
                      selectedReplyAssignedToOther ||
                      !hasConnectionContext ||
                      isPending ||
                      !draftMessage.trim()
                    }
                    onClick={() =>
                      selectedReplyThread && selectedThread &&
                      (() => {
                        setSelectedThreadId(selectedGroup?.id ?? selectedReplyThread.id);
                        void runAction(async () => {
                          await sendFrontMessage(selectedReplyThread.id, staffUserId, draftMessage);
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
