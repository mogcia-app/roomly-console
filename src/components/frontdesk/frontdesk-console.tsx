"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { HotelAuthCard } from "@/components/auth/hotel-auth-card";
import { FrontdeskShell } from "@/components/frontdesk/frontdesk-shell";
import {
  acceptCall,
  acceptHumanThread,
  endCall,
  markThreadSeenByFront,
  markCallUnavailable,
  resolveHumanThread,
  sendFrontMessage,
} from "@/lib/frontdesk/firestore";
import {
  formatInquiryType,
  formatRoomLabel,
  formatSenderLabel,
  formatStatusLabel,
  formatTime,
} from "@/lib/frontdesk/format";
import { FRONTDESK_NOTIFICATION_ENABLED_KEY } from "@/lib/frontdesk/preferences";
import type { CallRecord, ChatThreadRecord } from "@/lib/frontdesk/types";
import { useActiveCalls, useHumanThreads, useQueueCalls, useThreadCalls, useThreadMessages } from "@/hooks/useFrontdeskData";
import { useHotelAuth } from "@/hooks/useHotelAuth";

const defaultHotelId = process.env.NEXT_PUBLIC_DEFAULT_HOTEL_ID ?? "";

type ActionState = {
  kind: "success" | "error";
  message: string;
} | null;

type MobilePane = "list" | "chat";

function statusTone(status: CallRecord["status"] | ChatThreadRecord["status"]) {
  switch (status) {
    case "queue":
    case "new":
      return "bg-amber-100 text-amber-900";
    case "active":
    case "in_progress":
      return "bg-sky-100 text-sky-900";
    case "resolved":
    case "ended":
      return "bg-emerald-100 text-emerald-900";
    case "unavailable":
      return "bg-stone-200 text-stone-700";
    default:
      return "bg-stone-100 text-stone-700";
  }
}

function priorityValue(item: { emergency?: boolean; status?: string }) {
  if (item.emergency) {
    return 0;
  }

  if (item.status === "queue" || item.status === "new") {
    return 1;
  }

  if (item.status === "active" || item.status === "in_progress") {
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

function QueueCallCard({
  call,
  disabled,
  onAccept,
}: {
  call: CallRecord;
  disabled: boolean;
  onAccept: () => void;
}) {
  return (
    <article className="rounded-[24px] border border-stone-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-stone-100 text-base font-semibold text-stone-700">
          電話
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-[15px] font-semibold text-stone-950">
                  {formatRoomLabel(call.room_id, call.room_number)}
                </h3>
                {call.emergency ? (
                  <span className="rounded-full bg-[#fff1ef] px-2 py-0.5 text-[10px] font-semibold text-[#ad2218]">
                    緊急
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 line-clamp-1 text-sm text-stone-600">
                {formatInquiryType(call.event_type, "call")} / {call.guest_lang}
              </p>
            </div>
            <span className="shrink-0 text-xs text-stone-400">{formatTime(call.updated_at)}</span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(call.status)}`}>
              {formatStatusLabel(call.status)}
            </span>
            <button
              type="button"
              className="rounded-full bg-[#ad2218] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#951d15] disabled:cursor-not-allowed disabled:bg-stone-300"
              disabled={disabled}
              onClick={onAccept}
            >
              受ける
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ThreadListCard({
  thread,
  isSelected,
  selectedByOther,
  onClick,
}: {
  thread: ChatThreadRecord;
  isSelected: boolean;
  selectedByOther: boolean;
  onClick: () => void;
}) {
  const roomLabel = formatRoomLabel(thread.room_id, thread.room_number);

  return (
    <button
      type="button"
      className={`w-full rounded-[24px] border px-4 py-3 text-left transition ${
        isSelected
          ? "border-[#e8b7b1] bg-[#fff6f4] text-stone-950 shadow-sm"
          : "border-stone-200 bg-white text-stone-900 hover:border-stone-300"
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-stone-100 text-lg font-semibold text-stone-700">
          {(thread.room_number ?? thread.room_id).slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="truncate text-[15px] font-semibold">{roomLabel}</h3>
            <span className="shrink-0 text-xs text-stone-400">{formatTime(thread.updated_at)}</span>
          </div>
          <p className="line-clamp-1 text-sm text-stone-500">
            {thread.last_message_body ?? thread.category ?? formatInquiryType(thread.event_type, "chat")}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-stone-400">
              <span>{thread.guest_language ?? "言語未設定"}</span>
              {selectedByOther ? <span>他スタッフ対応中</span> : null}
            </div>
            {(thread.unread_count_front ?? 0) > 0 ? (
              <span className="grid h-6 min-w-6 place-items-center rounded-full bg-[#ad2218] px-1.5 text-[11px] font-semibold text-white">
                {Math.min(thread.unread_count_front ?? 0, 99)}
              </span>
            ) : thread.emergency ? (
              <span className="rounded-full bg-[#fff1ef] px-2 py-1 text-[11px] font-semibold text-[#ad2218]">緊急</span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

export function FrontdeskConsole() {
  const { user, claims, isLoading: authLoading, error: authError, login, logout } = useHotelAuth();
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [actionState, setActionState] = useState<ActionState>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>("list");
  const [isPending, startUiTransition] = useTransition();
  const notifiedCallIdsRef = useRef<Set<string>>(new Set());
  const notifiedThreadIdsRef = useRef<Set<string>>(new Set());

  const role = claims?.role;
  const canOperate = role === "hotel_front" || role === "hotel_admin";
  const hotelId = useDeferredValue((claims?.hotel_id ?? defaultHotelId).trim());
  const staffUserId = useDeferredValue(user?.uid ?? "");

  const queueCalls = useQueueCalls(hotelId);
  const activeCalls = useActiveCalls(hotelId, staffUserId);
  const humanThreads = useHumanThreads(hotelId);

  const prioritizedCalls = useMemo(() => sortByPriority(queueCalls.data), [queueCalls.data]);
  const prioritizedThreads = useMemo(() => sortByPriority(humanThreads.data), [humanThreads.data]);
  const filteredThreads = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return prioritizedThreads;
    }

    return prioritizedThreads.filter((thread) => {
      const room = formatRoomLabel(thread.room_id, thread.room_number).toLowerCase();
      const category = (thread.category ?? "").toLowerCase();
      const lang = (thread.guest_language ?? "").toLowerCase();

      return room.includes(query) || category.includes(query) || lang.includes(query);
    });
  }, [prioritizedThreads, searchQuery]);
  const selectedThread = useMemo(
    () => filteredThreads.find((thread) => thread.id === selectedThreadId) ?? filteredThreads[0] ?? null,
    [filteredThreads, selectedThreadId],
  );
  const effectiveSelectedThreadId = selectedThread?.id ?? "";
  const threadMessages = useThreadMessages(effectiveSelectedThreadId);
  const threadCalls = useThreadCalls(hotelId, effectiveSelectedThreadId);
  const selectedActiveCall = activeCalls.data[0] ?? null;
  const selectedThreadCall = useMemo(
    () =>
      threadCalls.data.find((call) => call.status === "active") ??
      threadCalls.data.find((call) => call.status === "queue") ??
      threadCalls.data.find((call) => call.status === "unavailable") ??
      null,
    [threadCalls.data],
  );
  const hasConnectionContext = Boolean(hotelId && staffUserId && canOperate);
  const selectedThreadMessages = useMemo(
    () => (selectedThread ? threadMessages.data.filter((message) => message.sender !== "system") : []),
    [selectedThread, threadMessages.data],
  );

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

    for (const call of prioritizedCalls) {
      if (notifiedCallIdsRef.current.has(call.id)) {
        continue;
      }

      notifiedCallIdsRef.current.add(call.id);
      new Notification("新しい着信", {
        body: `${formatRoomLabel(call.room_id, call.room_number)} / ${call.guest_lang}`,
      });
    }
  }, [prioritizedCalls]);

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
      if ((thread.unread_count_front ?? 0) <= 0 || notifiedThreadIdsRef.current.has(thread.id)) {
        continue;
      }

      notifiedThreadIdsRef.current.add(thread.id);
      new Notification("新しいフロント対応チャット", {
        body: `${formatRoomLabel(thread.room_id, thread.room_number)} / ${thread.last_message_body ?? thread.category ?? "新着メッセージ"}`,
      });
    }
  }, [prioritizedThreads]);

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
        description="Firebase Auth のメールログインで接続します。`role=hotel_front` または `hotel_admin` の custom claim が必要です。"
        isLoading={authLoading}
        onSubmit={login}
        title="hotel_front ログイン"
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
        const message = error instanceof Error ? error.message : "unknown-error";
        setActionState({ kind: "error", message });
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
      pageSubtitle="チャットと着信を同じ画面で処理します。"
      pageTitle="受信"
      onLogout={() => logout()}
      variant="messenger"
    >
          {!canOperate ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
              このアカウントには `hotel_front` または `hotel_admin` の custom claim が必要です。現在の role: {role ?? "未設定"}
            </div>
          ) : null}

          {actionState ? (
            <div
              className={`mx-4 mt-4 rounded-2xl border px-4 py-3 text-sm shadow-sm sm:mx-6 ${
                actionState.kind === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-rose-200 bg-rose-50 text-rose-900"
              }`}
            >
              {actionState.message}
            </div>
          ) : null}

          <div className="grid min-h-[calc(100vh-77px)] gap-0 lg:grid-cols-[360px_minmax(0,1fr)]">
            <aside
              id="priority"
              className={`${mobilePane === "chat" ? "hidden" : "block"} border-r border-stone-200 bg-[#f7f6f3] lg:block`}
            >
              <div className="border-b border-stone-200 bg-white px-4 py-4 sm:px-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold text-stone-950">トーク</h2>
                    <p className="text-sm text-stone-500">着信とチャットをまとめて確認</p>
                  </div>
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600">
                    {prioritizedCalls.length + prioritizedThreads.length}
                  </span>
                </div>
                <div className="mt-4 rounded-[28px] border border-stone-200 bg-[#f7f6f3] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-stone-400">🔎</span>
                    <input
                      className="w-full bg-transparent text-base outline-none placeholder:text-stone-400"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="検索"
                    />
                  </div>
                </div>
              </div>

              <div className="max-h-[calc(100vh-217px)] space-y-3 overflow-y-auto p-4">
                {selectedActiveCall ? (
                  <div className="rounded-[24px] border border-stone-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-stone-950">
                          {formatRoomLabel(selectedActiveCall.room_id, selectedActiveCall.room_number)}
                        </p>
                        <p className="mt-1 text-sm text-stone-500">
                          {formatInquiryType(selectedActiveCall.event_type, "call")} / {selectedActiveCall.guest_lang}
                        </p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(selectedActiveCall.status)}`}>
                        {formatStatusLabel(selectedActiveCall.status)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="mt-4 w-full rounded-full bg-[#ad2218] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#951d15] disabled:cursor-not-allowed disabled:bg-stone-300"
                      disabled={isPending}
                      onClick={() =>
                        void runAction(
                          () => endCall(selectedActiveCall.id),
                          `${formatRoomLabel(selectedActiveCall.room_id, selectedActiveCall.room_number)} の通話を終了しました。`,
                        )
                      }
                    >
                      通話終了
                    </button>
                  </div>
                ) : null}

                {queueCalls.isLoading || humanThreads.isLoading ? (
                  <p className="text-sm text-stone-500">一覧を読み込み中です。</p>
                ) : null}
                {queueCalls.error ? <p className="text-sm text-rose-700">{queueCalls.error}</p> : null}
                {humanThreads.error ? <p className="text-sm text-rose-700">{humanThreads.error}</p> : null}

                {prioritizedCalls.map((call) => (
                  <QueueCallCard
                    key={call.id}
                    call={call}
                    disabled={!hasConnectionContext || isPending}
                    onAccept={() =>
                      void runAction(
                        () => acceptCall(call.id),
                        `${formatRoomLabel(call.room_id, call.room_number)} の通話を受けました。`,
                      )
                    }
                  />
                ))}

                {filteredThreads.map((thread) => (
                  <ThreadListCard
                    key={thread.id}
                    thread={thread}
                    isSelected={selectedThread?.id === thread.id}
                    selectedByOther={
                      thread.status === "in_progress" && Boolean(thread.assigned_to && thread.assigned_to !== staffUserId)
                    }
                    onClick={() => handleSelectThread(thread.id)}
                  />
                ))}

                {!queueCalls.isLoading && !humanThreads.isLoading && prioritizedCalls.length === 0 && filteredThreads.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-stone-200 bg-white px-4 py-5 text-sm text-stone-500">
                    対応待ちの案件はありません。
                  </p>
                ) : null}
              </div>
            </aside>

            <section
              id="detail"
              className={`${mobilePane === "list" ? "hidden" : "block"} bg-[#ece8e1] lg:block`}
            >
              <div className="border-b border-stone-200 bg-white px-4 py-4 sm:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="mb-3 rounded-full border border-stone-200 px-3 py-1.5 text-sm text-stone-600 lg:hidden"
                      onClick={() => setMobilePane("list")}
                    >
                      一覧へ戻る
                    </button>
                    <div className="flex items-center gap-3">
                      {selectedThread ? (
                        <div className="grid h-12 w-12 place-items-center rounded-full bg-stone-100 text-lg font-semibold text-stone-700">
                          {(selectedThread.room_number ?? selectedThread.room_id).slice(0, 1)}
                        </div>
                      ) : null}
                      <div className="min-w-0">
                        <h2 className="truncate text-xl font-semibold text-stone-950">
                          {selectedThread ? formatRoomLabel(selectedThread.room_id, selectedThread.room_number) : "スレッド未選択"}
                        </h2>
                        <p className="truncate text-xs text-stone-500">
                          {selectedThread
                            ? `担当 ${selectedThread.assigned_to ?? "未着手"} / ${selectedThread.guest_language ?? "言語未設定"}`
                            : "左の一覧から問い合わせを選択してください。"}
                        </p>
                      </div>
                    </div>
                  </div>
                <div className="flex shrink-0 items-center gap-2">
                    {selectedThreadCall ? (
                      <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusTone(selectedThreadCall.status)}`}>
                        {selectedThreadCall.status === "queue"
                          ? "応答中"
                          : selectedThreadCall.status === "active"
                            ? "通話中"
                            : selectedThreadCall.status === "unavailable"
                              ? "不在"
                            : formatStatusLabel(selectedThreadCall.status)}
                      </span>
                    ) : null}
                    {selectedThread?.emergency ? (
                      <span className="rounded-full border border-[#e8b7b1] bg-[#fff1ef] px-3 py-1.5 text-xs font-semibold text-[#ad2218]">
                        緊急
                      </span>
                    ) : null}
                    {selectedThreadCall?.status === "queue" ? (
                      <>
                        <button
                          type="button"
                          className="rounded-full bg-[#ad2218] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#951d15] disabled:cursor-not-allowed disabled:bg-stone-300"
                          disabled={!hasConnectionContext || isPending}
                          onClick={() =>
                            void runAction(
                              () => acceptCall(selectedThreadCall.id),
                              `${formatRoomLabel(selectedThreadCall.room_id, selectedThreadCall.room_number)} の通話を受けました。`,
                            )
                          }
                        >
                          応答
                        </button>
                        <button
                          type="button"
                          className="rounded-full border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!hasConnectionContext || isPending}
                          onClick={() =>
                            void runAction(
                              () => markCallUnavailable(selectedThreadCall.id),
                              `${formatRoomLabel(selectedThreadCall.room_id, selectedThreadCall.room_number)} の通話を不在扱いにしました。`,
                            )
                          }
                        >
                          拒否
                        </button>
                      </>
                    ) : null}
                    {selectedThreadCall?.status === "active" ? (
                      <button
                        type="button"
                        className="rounded-full border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!hasConnectionContext || isPending}
                        onClick={() =>
                          void runAction(
                            () => endCall(selectedThreadCall.id),
                            `${formatRoomLabel(selectedThreadCall.room_id, selectedThreadCall.room_number)} の通話を終了しました。`,
                          )
                        }
                      >
                        通話終了
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-full border border-[#e8b7b1] bg-[#fff6f4] px-3 py-1.5 text-xs font-semibold text-[#ad2218] transition hover:bg-[#fff1ef] disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400"
                      disabled={!selectedThread || !hasConnectionContext || isPending}
                      onClick={() =>
                        selectedThread &&
                        void runAction(
                          () => acceptHumanThread(selectedThread.id, staffUserId),
                          `${formatRoomLabel(selectedThread.room_id, selectedThread.room_number)} のチャット着手を記録しました。`,
                        )
                      }
                    >
                      対応中
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!selectedThread || !hasConnectionContext || isPending}
                      onClick={() =>
                        selectedThread &&
                        void runAction(
                          () => resolveHumanThread(selectedThread.id, staffUserId),
                          `${formatRoomLabel(selectedThread.room_id, selectedThread.room_number)} のチャットを完了にしました。`,
                        )
                      }
                    >
                      完了
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex min-h-[calc(100vh-161px)] flex-col">
                <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
                  {selectedThreadId && threadCalls.isLoading ? (
                    <p className="text-sm text-stone-500">通話状態を読み込み中です。</p>
                  ) : null}
                  {threadCalls.error ? <p className="text-sm text-rose-500">{threadCalls.error}</p> : null}
                  {selectedThreadId && threadMessages.isLoading ? (
                    <p className="text-sm text-stone-500">メッセージを読み込み中です。</p>
                  ) : null}
                  {threadMessages.error ? <p className="text-sm text-rose-500">{threadMessages.error}</p> : null}
                  {!selectedThread ? (
                    <div className="rounded-[24px] border border-dashed border-stone-300 bg-white/80 px-4 py-8 text-center text-sm text-stone-500">
                      左のトーク一覧から問い合わせを選択すると会話が表示されます。
                    </div>
                  ) : null}
                  {selectedThread && selectedThreadMessages.length === 0 && !threadMessages.isLoading ? (
                    <div className="rounded-[24px] border border-dashed border-stone-300 bg-white/80 px-4 py-8 text-center text-sm text-stone-500">
                      まだメッセージがありません。
                    </div>
                  ) : null}
                  {selectedThreadMessages.map((message) => {
                    const isFront = message.sender === "front";
                    return (
                      <article key={message.id} className={`flex ${isFront ? "justify-end" : "justify-start"}`}>
                        <div className={`flex max-w-[82%] items-end gap-2 ${isFront ? "flex-row-reverse" : ""}`}>
                          <div
                            className={`rounded-[22px] px-4 py-3 shadow-sm ${
                              isFront ? "bg-[#ad2218] text-white" : "border border-stone-200 bg-white text-stone-900"
                            }`}
                          >
                            <div className="mb-1 flex items-center justify-between gap-4 text-[11px]">
                              <span className={isFront ? "text-white/80" : "text-stone-400"}>
                                {formatSenderLabel(message.sender)}
                              </span>
                            </div>
                            <p className="whitespace-pre-wrap text-[15px] leading-7">{message.body}</p>
                          </div>
                          <span className="shrink-0 text-[11px] text-stone-400">
                            {formatTime(message.timestamp)}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="border-t border-stone-200 bg-white px-4 py-4 sm:px-6">
                  <div className="flex items-end gap-3">
                    <textarea
                      className="min-h-14 flex-1 rounded-[24px] border border-stone-200 bg-[#f7f6f3] px-4 py-4 text-base text-stone-900 outline-none transition focus:border-stone-400"
                      value={draftMessage}
                      onChange={(event) => setDraftMessage(event.target.value)}
                      placeholder="メッセージを入力..."
                      disabled={!selectedThread}
                    />
                    <button
                      type="button"
                      className="grid h-14 w-14 shrink-0 place-items-center rounded-[20px] bg-[#ad2218] text-sm font-semibold text-white transition hover:bg-[#951d15] disabled:cursor-not-allowed disabled:bg-stone-300"
                      disabled={!selectedThread || !hasConnectionContext || isPending || !draftMessage.trim()}
                      onClick={() =>
                        selectedThread &&
                        void runAction(async () => {
                          await sendFrontMessage(selectedThread.id, staffUserId, draftMessage);
                          setDraftMessage("");
                        }, `${formatRoomLabel(selectedThread.room_id, selectedThread.room_number)} へ返信しました。`)
                      }
                    >
                      送信
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
    </FrontdeskShell>
  );
}
