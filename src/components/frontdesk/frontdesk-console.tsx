"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { HotelAuthCard } from "@/components/auth/hotel-auth-card";
import { FrontdeskShell } from "@/components/frontdesk/frontdesk-shell";
import {
  markThreadSeenByFront,
  resolveHumanThread,
  sendFrontMessage,
} from "@/lib/frontdesk/firestore";
import {
  formatInquiryType,
  formatRoomLabel,
  formatSenderLabel,
  formatTime,
} from "@/lib/frontdesk/format";
import { FRONTDESK_NOTIFICATION_ENABLED_KEY } from "@/lib/frontdesk/preferences";
import type { ChatThreadRecord, MessageRecord } from "@/lib/frontdesk/types";
import { useHotelRooms, useRecentThreads, useThreadMessages } from "@/hooks/useFrontdeskData";
import { useHotelAuth } from "@/hooks/useHotelAuth";

const defaultHotelId = process.env.NEXT_PUBLIC_DEFAULT_HOTEL_ID ?? "";

type ActionState = {
  kind: "success" | "error";
  message: string;
} | null;

type MobilePane = "list" | "chat";

function priorityValue(item: { emergency?: boolean; status?: string }) {
  if (item.emergency) {
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

function sortByPriority<T extends { emergency?: boolean; status?: string; updated_at?: { toDate(): Date } | null }>(
  items: T[],
) {
  return [...items].sort((left, right) => {
    const priorityDiff = priorityValue(left) - priorityValue(right);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return (right.updated_at?.toDate().getTime() ?? 0) - (left.updated_at?.toDate().getTime() ?? 0);
  });
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

function ThreadListCard({
  thread,
  roomLabel,
  isSelected,
  selectedByOther,
  onClick,
}: {
  thread: ChatThreadRecord;
  roomLabel: string;
  isSelected: boolean;
  selectedByOther: boolean;
  onClick: () => void;
}) {
  const roomInitial = roomLabel.slice(0, 1) || "客";

  return (
    <button
      type="button"
      className={`w-full rounded-[8px] border px-4 py-3.5 text-left transition ${
        isSelected
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
            <h3 className="truncate text-[15px] font-semibold text-stone-950">{roomLabel}</h3>
            <span className="shrink-0 text-[11px] text-stone-400">{formatTime(thread.updated_at)}</span>
          </div>
          <p className="mt-1 line-clamp-1 text-sm text-stone-500">
            {thread.last_message_body ?? thread.category ?? formatInquiryType(thread.event_type, "chat")}
          </p>
          <div className="mt-3 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-stone-400">
              <span>{thread.guest_language ?? "言語未設定"}</span>
              {selectedByOther ? <span>他スタッフ対応中</span> : null}
            </div>
            {(thread.unread_count_front ?? 0) > 0 ? (
              <span className="block h-2.5 w-2.5 rounded-full bg-[#ad2218]" aria-label="未読あり" />
            ) : thread.emergency ? (
              <span className="rounded-full bg-[#fff3f1] px-2 py-1 text-[11px] font-semibold text-[#d14b3d]">緊急</span>
            ) : thread.status === "resolved" ? (
              <span className="text-[11px] text-stone-400">完了</span>
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
  const [isPending, startUiTransition] = useTransition();
  const notifiedThreadIdsRef = useState(() => new Set<string>())[0];

  const role = claims?.role;
  const canOperate = role === "hotel_front" || role === "hotel_admin";
  const hotelId = useDeferredValue((claims?.hotel_id ?? defaultHotelId).trim());
  const staffUserId = useDeferredValue(user?.uid ?? "");
  const recentThreads = useRecentThreads(hotelId);
  const hotelRooms = useHotelRooms(hotelId);

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
  const filteredThreads = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return prioritizedThreads;
    }

    return prioritizedThreads.filter((thread) => {
      const room = resolveRoomLabel(
        thread.room_id,
        thread.room_number,
        thread.room_display_name,
        roomDisplayNames,
      ).toLowerCase();
      const category = (thread.category ?? "").toLowerCase();
      const lang = (thread.guest_language ?? "").toLowerCase();
      return room.includes(query) || category.includes(query) || lang.includes(query);
    });
  }, [prioritizedThreads, roomDisplayNames, searchQuery]);

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
  const effectiveSelectedThreadId = selectedThread?.id ?? "";
  const threadMessages = useThreadMessages(effectiveSelectedThreadId);
  const selectedThreadMessages = useMemo(
    () => (selectedThread ? threadMessages.data.filter((message) => message.sender !== "system") : []),
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
    if (typeof window === "undefined") {
      return;
    }

    if (!("Notification" in window) || Notification.permission !== "granted") {
      return;
    }

    if (window.localStorage.getItem(FRONTDESK_NOTIFICATION_ENABLED_KEY) === "false") {
      return;
    }

    for (const thread of prioritizedThreads) {
      if ((thread.unread_count_front ?? 0) <= 0 || notifiedThreadIdsRef.has(thread.id)) {
        continue;
      }

      notifiedThreadIdsRef.add(thread.id);
      new Notification("新しいフロント対応チャット", {
        body: `${resolveRoomLabel(thread.room_id, thread.room_number, thread.room_display_name, roomDisplayNames)} / ${thread.last_message_body ?? thread.category ?? "新着メッセージ"}`,
      });
    }
  }, [notifiedThreadIdsRef, prioritizedThreads, roomDisplayNames]);

  useEffect(() => {
    if (!selectedThread || !hasConnectionContext) {
      return;
    }

    if ((selectedThread.unread_count_front ?? 0) <= 0) {
      return;
    }

    void markThreadSeenByFront(selectedThread.id);
  }, [hasConnectionContext, selectedThread]);

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

  return (
    <FrontdeskShell
      pageSubtitle="問い合わせ確認と返信をまとめて行えます"
      pageTitle="チャット"
      onLogout={() => logout()}
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

      <div className="px-3 pb-3 pt-5 sm:px-6 lg:hidden">
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

      <div className="grid min-h-[calc(100dvh-182px)] gap-3 px-3 pb-3 pt-2 sm:px-6 sm:pt-3 lg:min-h-[calc(100vh-88px)] lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-4 lg:px-6 lg:pt-5 xl:grid-cols-[390px_minmax(0,1fr)]">
        <aside id="priority" className={`${mobilePane === "chat" ? "hidden" : "block"} lg:block`}>
          <div className="overflow-hidden rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] shadow-[0_12px_30px_rgba(72,32,28,0.06)]">
            <div className="border-b border-[#ecd2cf] bg-white px-4 py-4 sm:px-5 lg:px-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-stone-950 sm:text-xl">トーク一覧</h2>
                  <p className="text-sm text-stone-500">
                    新着 {threadSummary.newCount} 件 / 緊急 {threadSummary.emergencyCount} 件
                  </p>
                </div>
                <span className="rounded-full bg-[#fff1ef] px-3 py-1 text-xs font-semibold text-[#ad2218]">
                  {filteredThreads.length}
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

            <div className="space-y-3 overflow-y-auto p-3 lg:max-h-[calc(100vh-180px)] lg:p-4">
              {recentThreads.isLoading ? <p className="text-sm text-stone-500">一覧を読み込み中です</p> : null}
              {recentThreads.error ? <p className="text-sm text-rose-700">{recentThreads.error}</p> : null}

              {filteredThreads.map((thread) => (
                <ThreadListCard
                  key={thread.id}
                  thread={thread}
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
                  onClick={() => handleSelectThread(thread.id)}
                />
              ))}

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
                      {!selectedThread ? (
                        <p className="mt-1 truncate text-xs text-stone-500">左の一覧から問い合わせを選択してください</p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="hidden lg:flex lg:items-center lg:gap-2">
                  {selectedThread?.status !== "resolved" ? (
                    <button
                      type="button"
                      className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!selectedThread || !hasConnectionContext || isPending}
                      onClick={() =>
                        selectedThread &&
                        void runAction(
                          () => resolveHumanThread(selectedThread.id, staffUserId),
                          `${resolveRoomLabel(
                            selectedThread.room_id,
                            selectedThread.room_number,
                            selectedThread.room_display_name,
                            roomDisplayNames,
                          )} のチャットを完了にしました`,
                        )
                      }
                    >
                      完了
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex min-h-[calc(100dvh-318px)] flex-col lg:min-h-[calc(100vh-210px)]">
              <div className="flex-1 space-y-4 overflow-y-auto bg-white px-4 py-5 sm:px-5 lg:px-6 lg:py-6">
                <div className="flex items-center justify-between gap-3 lg:hidden">
                  <button
                    type="button"
                    className="rounded-full border border-stone-200 px-3 py-1.5 text-sm text-stone-600"
                    onClick={() => setMobilePane("list")}
                  >
                    一覧へ戻る
                  </button>
                  {selectedThread?.status !== "resolved" ? (
                    <button
                      type="button"
                      className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!selectedThread || !hasConnectionContext || isPending}
                      onClick={() =>
                        selectedThread &&
                        void runAction(
                          () => resolveHumanThread(selectedThread.id, staffUserId),
                          `${resolveRoomLabel(
                            selectedThread.room_id,
                            selectedThread.room_number,
                            selectedThread.room_display_name,
                            roomDisplayNames,
                          )} のチャットを完了にしました`,
                        )
                      }
                    >
                      完了
                    </button>
                  ) : null}
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
                            <div className="mt-2 text-xs font-semibold text-amber-700">翻訳確認推奨</div>
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

              <div className="border-t border-[#ecd2cf] bg-white px-4 py-3 sm:px-6 lg:px-6">
                <div className="flex items-end gap-3">
                  <textarea
                    rows={1}
                    className="h-12 flex-1 resize-none rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] px-4 py-3 text-base leading-6 text-stone-900 outline-none transition focus:border-[#ad2218]"
                    value={draftMessage}
                    onChange={(event) => setDraftMessage(event.target.value)}
                    placeholder="メッセージを入力"
                    disabled={!selectedThread}
                  />
                  <button
                    type="button"
                    className="grid h-12 min-w-12 shrink-0 place-items-center rounded-[8px] bg-[#ad2218] px-4 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(173,34,24,0.22)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:shadow-none sm:min-w-24"
                    disabled={!selectedThread || !hasConnectionContext || isPending || !draftMessage.trim()}
                    onClick={() =>
                      selectedThread &&
                      void runAction(async () => {
                        await sendFrontMessage(selectedThread.id, staffUserId, draftMessage);
                        setDraftMessage("");
                      }, `${resolveRoomLabel(
                        selectedThread.room_id,
                        selectedThread.room_number,
                        selectedThread.room_display_name,
                        roomDisplayNames,
                      )} に返信しました`)
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
