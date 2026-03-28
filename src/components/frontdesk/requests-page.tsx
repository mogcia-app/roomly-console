"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { HotelAuthCard } from "@/components/auth/hotel-auth-card";
import { FrontdeskShell } from "@/components/frontdesk/frontdesk-shell";
import {
  acceptHumanThread,
  assignHumanThread,
  resolveHumanThread,
} from "@/lib/frontdesk/firestore";
import { formatDateTime, formatInquiryType, formatRoomLabel } from "@/lib/frontdesk/format";
import type { ChatThreadRecord } from "@/lib/frontdesk/types";
import { useHumanThreads } from "@/hooks/useFrontdeskData";
import { useHotelAuth } from "@/hooks/useHotelAuth";

const defaultHotelId = process.env.NEXT_PUBLIC_DEFAULT_HOTEL_ID ?? "";

type ActionState = {
  kind: "success" | "error";
  message: string;
} | null;

function isRequestThread(thread: ChatThreadRecord) {
  const category = thread.category ?? "";
  return category.includes("依頼") || category.includes("追加") || category.includes("希望");
}

function RequestCard({
  thread,
  currentUserId,
  disabled,
  onAssignToMe,
  onStart,
  onResolve,
}: {
  thread: ChatThreadRecord;
  currentUserId: string;
  disabled: boolean;
  onAssignToMe: () => void;
  onStart: () => void;
  onResolve: () => void;
}) {
  const assignedToMe = thread.assigned_to === currentUserId;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-slate-950">
            {formatRoomLabel(thread.room_id, thread.room_number)}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            {formatInquiryType(thread.event_type, "chat")} / {thread.category ?? "カテゴリ未設定"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            言語: {thread.guest_language ?? "未設定"} / stay: {thread.stay_id}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              thread.status === "resolved"
                ? "bg-emerald-100 text-emerald-800"
                : thread.status === "in_progress"
                  ? "bg-blue-100 text-blue-800"
                  : "bg-amber-100 text-amber-800"
            }`}
          >
            {thread.status === "resolved" ? "完了" : thread.status === "in_progress" ? "対応中" : "未着手"}
          </span>
          {thread.emergency ? (
            <span className="rounded-full bg-rose-100 px-2 py-1 text-[11px] font-semibold text-rose-800">
              緊急
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-sm text-slate-500">
        <div className="flex items-center justify-between gap-3">
          <span>担当者</span>
          <span className="font-medium text-slate-700">{thread.assigned_to ?? "未割当"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>更新時刻</span>
          <span className="font-medium text-slate-700">{formatDateTime(thread.updated_at)}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || assignedToMe}
          onClick={onAssignToMe}
        >
          自分に割当
        </button>
        <button
          type="button"
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || thread.status === "in_progress"}
          onClick={onStart}
        >
          対応開始
        </button>
        <button
          type="button"
          className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={disabled || thread.status === "resolved"}
          onClick={onResolve}
        >
          完了
        </button>
      </div>
    </article>
  );
}

export function FrontdeskRequestsPage() {
  const { user, claims, isLoading: authLoading, error: authError, login, logout } = useHotelAuth();
  const [actionState, setActionState] = useState<ActionState>(null);
  const [isPending, startTransition] = useTransition();

  const hotelId = useDeferredValue((claims?.hotel_id ?? defaultHotelId).trim());
  const staffUserId = useDeferredValue(user?.uid ?? "");
  const humanThreads = useHumanThreads(hotelId);

  const requestThreads = useMemo(
    () => humanThreads.data.filter(isRequestThread),
    [humanThreads.data],
  );
  const newThreads = requestThreads.filter((thread) => thread.status === "new");
  const inProgressThreads = requestThreads.filter((thread) => thread.status === "in_progress");
  const doneThreads = requestThreads.filter((thread) => thread.status === "resolved");

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

  function runAction(action: () => Promise<void>, successMessage: string) {
    setActionState(null);

    startTransition(async () => {
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

  return (
    <FrontdeskShell
      pageSubtitle="依頼をタスクとして見て、その場で担当開始・完了・担当変更を行います。"
      pageTitle="依頼"
      onLogout={() => logout()}
    >
      {actionState ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${
            actionState.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          {actionState.message}
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-3">
        <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">未着手</h3>
              <p className="text-sm text-slate-500">新しく来た依頼</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
              {newThreads.length}
            </span>
          </div>
          <div className="space-y-3">
            {newThreads.map((thread) => (
              <RequestCard
                key={thread.id}
                thread={thread}
                currentUserId={staffUserId}
                disabled={isPending}
                onAssignToMe={() =>
                  runAction(
                    () => assignHumanThread(thread.id, staffUserId),
                    `${formatRoomLabel(thread.room_id, thread.room_number)} を自分に割り当てました。`,
                  )
                }
                onStart={() =>
                  runAction(
                    () => acceptHumanThread(thread.id, staffUserId),
                    `${formatRoomLabel(thread.room_id, thread.room_number)} の依頼対応を開始しました。`,
                  )
                }
                onResolve={() =>
                  runAction(
                    () => resolveHumanThread(thread.id, staffUserId),
                    `${formatRoomLabel(thread.room_id, thread.room_number)} の依頼を完了にしました。`,
                  )
                }
              />
            ))}
            {newThreads.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                未着手の依頼はありません。
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">対応中</h3>
              <p className="text-sm text-slate-500">担当者が付いている依頼</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
              {inProgressThreads.length}
            </span>
          </div>
          <div className="space-y-3">
            {inProgressThreads.map((thread) => (
              <RequestCard
                key={thread.id}
                thread={thread}
                currentUserId={staffUserId}
                disabled={isPending}
                onAssignToMe={() =>
                  runAction(
                    () => assignHumanThread(thread.id, staffUserId),
                    `${formatRoomLabel(thread.room_id, thread.room_number)} の担当を自分へ変更しました。`,
                  )
                }
                onStart={() =>
                  runAction(
                    () => acceptHumanThread(thread.id, staffUserId),
                    `${formatRoomLabel(thread.room_id, thread.room_number)} の依頼対応を開始しました。`,
                  )
                }
                onResolve={() =>
                  runAction(
                    () => resolveHumanThread(thread.id, staffUserId),
                    `${formatRoomLabel(thread.room_id, thread.room_number)} の依頼を完了にしました。`,
                  )
                }
              />
            ))}
            {inProgressThreads.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                対応中の依頼はありません。
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">完了</h3>
              <p className="text-sm text-slate-500">直近で処理済みの依頼</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
              {doneThreads.length}
            </span>
          </div>
          <div className="space-y-3">
            {doneThreads.map((thread) => (
              <RequestCard
                key={thread.id}
                thread={thread}
                currentUserId={staffUserId}
                disabled={true}
                onAssignToMe={() => undefined}
                onStart={() => undefined}
                onResolve={() => undefined}
              />
            ))}
            {doneThreads.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                完了済みの依頼はありません。
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </FrontdeskShell>
  );
}
