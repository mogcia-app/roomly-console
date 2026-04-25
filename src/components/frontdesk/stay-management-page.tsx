"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { HotelAuthCard } from "@/components/auth/hotel-auth-card";
import { FrontdeskAuthLoading } from "@/components/frontdesk/frontdesk-auth-loading";
import { FrontdeskShell } from "@/components/frontdesk/frontdesk-shell";
import { useHotelAdminRoomStatuses } from "@/hooks/useHotelAdminRoomStatuses";
import { useHotelAuth } from "@/hooks/useHotelAuth";
import { useCompactModePreference } from "@/hooks/useFrontdeskPreferences";
import { getFirebaseAuth } from "@/lib/firebase";
import { formatGuestLanguageLabel, SUPPORTED_GUEST_LANGUAGE_OPTIONS } from "@/lib/frontdesk/languages";
import { formatDateTime, formatRoomLabel } from "@/lib/frontdesk/format";
import type { RoomRecord, RoomStatusRecord } from "@/lib/frontdesk/types";

type ActionState = {
  kind: "success" | "error";
  message: string;
} | null;

type CheckInDraft = {
  guestCount: string;
  guestLanguage: string;
  guestName: string;
  notes: string;
  checkInAt: string;
  scheduledCheckOutAt: string;
};

function toDateTimeLocalString(date: Date) {
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function buildInitialCheckInAtValue() {
  return toDateTimeLocalString(new Date());
}

function buildInitialScheduledCheckOutAtValue() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  return toDateTimeLocalString(date);
}

const emptyCheckInDraft: CheckInDraft = {
  guestCount: "2",
  guestLanguage: "ja",
  guestName: "",
  notes: "",
  checkInAt: buildInitialCheckInAtValue(),
  scheduledCheckOutAt: buildInitialScheduledCheckOutAtValue(),
};

function occupancyLabel(status: RoomStatusRecord["status"]) {
  switch (status) {
    case "occupied":
      return "滞在中";
    case "conflict":
      return "要確認";
    default:
      return "空室";
  }
}

function occupancyTone(status: RoomStatusRecord["status"]) {
  switch (status) {
    case "occupied":
      return "bg-emerald-100 text-emerald-900";
    case "conflict":
      return "bg-amber-100 text-amber-900";
    default:
      return "bg-stone-200 text-stone-700";
  }
}

function infoValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value);
}

function formatFloorLabel(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return /[Ff階]$/.test(trimmed) ? trimmed : `${trimmed}階`;
}

function resolveCheckInValidation(draft: CheckInDraft) {
  const guestCount = Number.parseInt(draft.guestCount, 10);
  const hasValidGuestCount = Number.isFinite(guestCount) && guestCount > 0;
  const checkInTime = Date.parse(draft.checkInAt);
  const scheduledCheckOutTime = Date.parse(draft.scheduledCheckOutAt);
  const hasValidCheckInAt = Number.isFinite(checkInTime);
  const hasValidScheduledCheckOutAt = Number.isFinite(scheduledCheckOutTime);
  const hasValidTimeOrder =
    hasValidCheckInAt && hasValidScheduledCheckOutAt ? scheduledCheckOutTime > checkInTime : true;

  return {
    guestCount: hasValidGuestCount ? guestCount : null,
    hasValidGuestCount,
    hasValidCheckInAt,
    hasValidScheduledCheckOutAt,
    hasValidTimeOrder,
    canSubmit:
      hasValidGuestCount &&
      hasValidCheckInAt &&
      hasValidScheduledCheckOutAt &&
      hasValidTimeOrder,
  };
}

async function authorizedFetch(input: RequestInfo, init?: RequestInit) {
  const auth = getFirebaseAuth();
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error("not-authenticated");
  }

  const token = await currentUser.getIdToken();

  return fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

export function FrontdeskStayManagementPage() {
  const { user, claims, isLoading: authLoading, error: authError, login, logout } = useHotelAuth();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [checkInDrafts, setCheckInDrafts] = useState<Record<string, CheckInDraft>>({});
  const [expandedRoomId, setExpandedRoomId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | RoomStatusRecord["status"]>("all");
  const [actionState, setActionState] = useState<ActionState>(null);
  const [isPending, startTransition] = useTransition();
  const [compactMode] = useCompactModePreference();

  const role = claims?.role;
  const isAdmin = role === "hotel_admin";
  const roomsQuery = useHotelAdminRoomStatuses(Boolean(user && isAdmin));
  const sortedRooms = useMemo(() => roomsQuery.rooms, [roomsQuery.rooms]);
  const summary = useMemo(
    () => ({
      total: sortedRooms.length,
      vacant: sortedRooms.filter((item) => item.status === "vacant").length,
      occupied: sortedRooms.filter((item) => item.status === "occupied").length,
      conflict: sortedRooms.filter((item) => item.status === "conflict").length,
    }),
    [sortedRooms],
  );
  const filteredRooms = useMemo(
    () => (statusFilter === "all" ? sortedRooms : sortedRooms.filter((item) => item.status === statusFilter)),
    [sortedRooms, statusFilter],
  );
  const expandedRoom = useMemo(
    () => sortedRooms.find((item) => item.room.id === expandedRoomId) ?? null,
    [expandedRoomId, sortedRooms],
  );
  const expandedRoomDraft = expandedRoom ? (checkInDrafts[expandedRoom.room.id] ?? emptyCheckInDraft) : emptyCheckInDraft;
  const expandedRoomValidation = resolveCheckInValidation(expandedRoomDraft);

  useEffect(() => {
    if (!roomsQuery.rooms.length) {
      return;
    }

    setDrafts((current) => {
      const nextDrafts = { ...current };

      for (const item of roomsQuery.rooms) {
        const room = item.room;
        if (!(room.id in nextDrafts)) {
          nextDrafts[room.id] = room.display_name ?? "";
        }
      }

      return nextDrafts;
    });
  }, [roomsQuery.rooms]);

  useEffect(() => {
    if (!roomsQuery.rooms.length) {
      return;
    }

    setCheckInDrafts((current) => {
      const nextDrafts = { ...current };

      for (const item of roomsQuery.rooms) {
        const room = item.room;
        if (!(room.id in nextDrafts)) {
          nextDrafts[room.id] = {
            ...emptyCheckInDraft,
          };
        }
      }

      return nextDrafts;
    });
  }, [roomsQuery.rooms]);

  if (authLoading) {
    return <FrontdeskAuthLoading title="hotel_admin ログイン" />;
  }

  if (!user) {
    return (
      <HotelAuthCard
        authError={authError}
        description="登録済みのメールアドレスとパスワードでログインしてください"
        isLoading={authLoading}
        onSubmit={login}
        title="hotel_admin ログイン"
      />
    );
  }

  async function handleSave(room: RoomRecord) {
    setActionState(null);

    startTransition(async () => {
      try {
        const response = await authorizedFetch(`/api/admin/rooms/${room.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            displayName: drafts[room.id]?.trim() || null,
          }),
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "failed-to-update-room");
        }

        await roomsQuery.refresh();
        setActionState({
          kind: "success",
          message: `${room.room_number} の表示名を更新しました`,
        });
      } catch (error) {
        setActionState({
          kind: "error",
          message: error instanceof Error ? error.message : "failed-to-update-room",
        });
      }
    });
  }

  async function handleCheckIn(item: RoomStatusRecord) {
    const room = item.room;
    const draft = checkInDrafts[room.id] ?? emptyCheckInDraft;
    const validation = resolveCheckInValidation(draft);

    if (!validation.canSubmit || validation.guestCount === null) {
      setActionState({
        kind: "error",
        message: "宿泊登録の入力内容を確認してください",
      });
      return;
    }

    setActionState(null);

    startTransition(async () => {
      try {
        const response = await authorizedFetch("/api/admin/stays/check-in", {
          method: "POST",
          body: JSON.stringify({
            roomId: room.room_id,
            guestCount: validation.guestCount,
            guestLanguage: draft.guestLanguage,
            guestName: draft.guestName || undefined,
            notes: draft.notes || undefined,
            checkInAt: draft.checkInAt || undefined,
            scheduledCheckOutAt: draft.scheduledCheckOutAt || undefined,
          }),
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "failed-to-check-in");
        }

        setExpandedRoomId(null);
        await roomsQuery.refresh();
        setActionState({
          kind: "success",
          message: `${room.room_number} の宿泊登録を完了しました`,
        });
      } catch (error) {
        setActionState({
          kind: "error",
          message:
            error instanceof Error && error.message === "active-stay-exists"
              ? "この部屋には既に滞在中データがあります"
              : error instanceof Error && error.message === "invalid-check-out-time"
                ? "予定チェックアウト時刻はチェックイン時刻より後にしてください"
                : error instanceof Error
                  ? error.message
                  : "failed-to-check-in",
        });
      }
    });
  }

  async function handleCheckOut(item: RoomStatusRecord) {
    const room = item.room;
    setActionState(null);

    startTransition(async () => {
      try {
        const response = await authorizedFetch("/api/admin/stays/check-out", {
          method: "POST",
          body: JSON.stringify({
            roomId: room.room_id,
          }),
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "failed-to-check-out");
        }

        await roomsQuery.refresh();
        setActionState({
          kind: "success",
          message: `${room.room_number} をチェックアウトしました`,
        });
      } catch (error) {
        setActionState({
          kind: "error",
          message:
            error instanceof Error && error.message === "active-stay-not-found"
              ? "この部屋に有効な滞在データがありません"
              : error instanceof Error
                ? error.message
                : "failed-to-check-out",
        });
      }
    });
  }

  return (
    <FrontdeskShell
      compactMode={compactMode}
      fixedHeader
      pageSubtitle="客室ごとの滞在状況、チェックイン、チェックアウトを一覧で管理できます"
      pageTitle="滞在管理"
      onLogout={() => logout()}
      role={role}
    >
      <div className={`min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8 ${compactMode ? "space-y-4" : "space-y-5"}`}>
        {!isAdmin ? (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            この画面には `hotel_admin` 権限が必要です 現在の role: {role ?? "未設定"}
          </div>
        ) : null}

        {actionState ? (
          <div
            className={`rounded-[10px] border px-4 py-3 text-sm ${
              actionState.kind === "success"
                ? "border-[#e7c0bb] bg-[#fff1ef] text-[#ad2218]"
                : "border-rose-200 bg-rose-50 text-rose-900"
            }`}
          >
            {actionState.message}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "総客室", value: summary.total, tone: "bg-white" },
            { label: "滞在中", value: summary.occupied, tone: "bg-emerald-50" },
            { label: "要確認", value: summary.conflict, tone: "bg-amber-50" },
            { label: "空室", value: summary.vacant, tone: "bg-stone-100" },
          ].map((item) => (
            <article
              key={item.label}
              className={`rounded-[10px] border border-[#ecd2cf] ${item.tone} px-5 py-5 shadow-[0_12px_30px_rgba(72,32,28,0.06)]`}
            >
              <p className="text-xs uppercase tracking-[0.16em] text-stone-500">{item.label}</p>
              <p className="mt-3 text-3xl font-semibold text-stone-950">{item.value}</p>
            </article>
          ))}
        </section>

        <section className="overflow-hidden rounded-[10px] border border-[#ecd2cf] bg-[#fff8f7] shadow-[0_12px_30px_rgba(72,32,28,0.06)]">
          <div className="border-b border-[#ecd2cf] bg-white px-5 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ad2218]">Stay Overview</p>
                <h3 className="mt-2 text-xl font-semibold text-stone-950">客室ボード</h3>
                <p className="mt-2 text-sm leading-6 text-stone-500">
                  客室ごとの滞在状況、ゲスト情報、運用メモを一覧で確認しながら対応できます
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "all", label: "すべて" },
                  { key: "occupied", label: "滞在中" },
                  { key: "conflict", label: "要確認" },
                  { key: "vacant", label: "空室" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`rounded-full px-3 py-2 text-sm font-semibold transition ${
                      statusFilter === item.key
                        ? "bg-[#ad2218] text-white"
                        : "border border-[#ecd2cf] bg-[#fff8f7] text-stone-600"
                    }`}
                    onClick={() => setStatusFilter(item.key as "all" | RoomStatusRecord["status"])}
                  >
                    {item.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="rounded-full border border-[#ecd2cf] bg-white px-3 py-2 text-sm text-stone-600 transition hover:bg-[#fff8f7]"
                  onClick={() => void roomsQuery.refresh()}
                >
                  再読込
                </button>
              </div>
            </div>
          </div>

          <div className="p-4">
            {roomsQuery.error ? <p className="mb-4 text-sm text-rose-700">{roomsQuery.error}</p> : null}
            {roomsQuery.isLoading ? <p className="text-sm text-stone-500">客室一覧を読み込み中です</p> : null}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredRooms.map((item) => {
                const room = item.room;
                const activeStay = item.active_stay ?? null;
                const draftValue = drafts[room.id] ?? room.display_name ?? "";
                const normalizedDraft = draftValue.trim();
                const normalizedCurrent = room.display_name?.trim() ?? "";
                const isDirty = normalizedDraft !== normalizedCurrent;

                return (
                  <article key={room.id} className="rounded-[10px] border border-[#ecd2cf] bg-white p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs uppercase tracking-[0.16em] text-stone-400">Room {room.room_number}</p>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <h3 className="text-lg font-semibold text-stone-950">
                          {draftValue.trim() || formatRoomLabel(room.room_id, room.room_number, room.display_name)}
                        </h3>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${occupancyTone(item.status)}`}>
                          {occupancyLabel(item.status)}
                        </span>
                      </div>
                    </div>

                    {room.floor ? <span className="text-xs text-stone-400">{formatFloorLabel(room.floor)}</span> : null}
                  </div>

                  <dl className="mt-4 grid gap-3 text-sm">
                    <div>
                      <dt className="text-stone-400">ゲスト</dt>
                      <dd className="mt-1 font-medium text-stone-900">{infoValue(activeStay?.guest_name)}</dd>
                    </div>
                    <div>
                      <dt className="text-stone-400">言語 / チェックアウト</dt>
                      <dd className="mt-1 text-stone-700">
                        {activeStay?.guest_language ? formatGuestLanguageLabel(activeStay.guest_language) : "-"} /{" "}
                        {activeStay?.scheduled_check_out_at ? formatDateTime(activeStay.scheduled_check_out_at) : "未設定"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-stone-400">運用メモ</dt>
                      <dd className="mt-1 leading-6 text-stone-700">
                        {activeStay?.notes?.trim()
                          ? activeStay.notes
                          : item.status === "vacant"
                            ? "現在滞在中のゲストはいません"
                            : item.status === "conflict"
                              ? "滞在データが複数あるため、内容の確認が必要です"
                              : `チェックイン ${formatDateTime(activeStay?.check_in_at)} / 宿泊人数 ${infoValue(activeStay?.guest_count)}`}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-4 grid grid-cols-[minmax(0,1fr)_64px] items-end gap-2">
                    <label className="grid gap-1.5 text-sm">
                      <span className="text-stone-500">表示名</span>
                      <input
                        className="rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] px-3 py-2.5 text-sm outline-none transition focus:border-[#ad2218]"
                        value={draftValue}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [room.id]: event.target.value,
                          }))
                        }
                        placeholder="梅の部屋"
                      />
                    </label>
                    <button
                      type="button"
                      className="rounded-[8px] border border-[#ecd2cf] bg-white px-2 py-2.5 text-xs font-semibold text-stone-700 transition hover:bg-[#fff8f7] disabled:cursor-not-allowed disabled:bg-stone-100"
                      disabled={!isAdmin || isPending || !isDirty}
                      onClick={() => void handleSave(room)}
                    >
                      保存
                    </button>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.status === "conflict" ? (
                      <span className="rounded-full border border-[#ecd2cf] bg-[#fff8f7] px-2.5 py-1 text-xs font-medium text-stone-700">
                        要確認
                      </span>
                    ) : null}
                    {activeStay?.guest_count ? (
                      <span className="rounded-full border border-[#ecd2cf] bg-[#fff8f7] px-2.5 py-1 text-xs font-medium text-stone-700">
                        {activeStay.guest_count}名
                      </span>
                    ) : null}
                    {activeStay?.guest_language ? (
                      <span className="rounded-full border border-[#ecd2cf] bg-[#fff8f7] px-2.5 py-1 text-xs font-medium text-stone-700">
                        {formatGuestLanguageLabel(activeStay.guest_language)}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-[8px] border border-[#ecd2cf] bg-white px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-[#fff8f7] disabled:cursor-not-allowed disabled:bg-stone-100"
                      disabled={!isAdmin || isPending}
                      onClick={() => setExpandedRoomId(room.id)}
                    >
                      宿泊登録
                    </button>
                    <button
                      type="button"
                      className="rounded-[8px] border border-[#ecd2cf] bg-white px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-[#fff8f7] disabled:cursor-not-allowed disabled:bg-stone-100"
                      disabled={!isAdmin || isPending || !activeStay}
                      onClick={() => void handleCheckOut(item)}
                    >
                      チェックアウト
                    </button>
                  </div>
                  </article>
                );
              })}

              {!roomsQuery.isLoading && filteredRooms.length === 0 ? (
                <p className="rounded-[10px] border border-dashed border-[#ecd2cf] bg-white px-4 py-6 text-sm text-stone-500 md:col-span-2 xl:col-span-3">
                  客室データがまだありません
                </p>
              ) : null}
            </div>

            {expandedRoom ? (
              <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6">
                <button
                  type="button"
                  className="absolute inset-0 cursor-default"
                  aria-label="モーダルを閉じる"
                  onClick={() => setExpandedRoomId(null)}
                />
                <section className="relative z-10 w-full max-w-2xl rounded-t-2xl border border-[#ecd2cf] bg-white shadow-[0_30px_60px_rgba(20,14,10,0.24)] sm:rounded-2xl">
                  <header className="border-b border-[#ecd2cf] px-5 py-4 sm:px-6">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ad2218]">Stay Registration</p>
                    <h4 className="mt-1 text-lg font-semibold text-stone-950">
                      {expandedRoom.room.room_number} の宿泊登録
                    </h4>
                    <p className="mt-1 text-xs text-stone-500">
                      必須: 宿泊人数 / 使用言語 / チェックイン時刻 / 予定チェックアウト時刻
                    </p>
                  </header>

                  <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 sm:px-6">
                    <label className="grid gap-2 text-sm">
                      <span>
                        宿泊人数 <span className="text-[11px] text-rose-700">必須</span>
                      </span>
                      <input
                        className="rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] px-3 py-2.5 outline-none transition focus:border-[#ad2218]"
                        type="number"
                        min={1}
                        step={1}
                        value={expandedRoomDraft.guestCount}
                        onChange={(event) =>
                          setCheckInDrafts((current) => ({
                            ...current,
                            [expandedRoom.room.id]: {
                              ...(current[expandedRoom.room.id] ?? emptyCheckInDraft),
                              guestCount: event.target.value,
                            },
                          }))
                        }
                        placeholder="2"
                      />
                      {!expandedRoomValidation.hasValidGuestCount ? (
                        <p className="text-xs text-rose-700">1 以上の人数を入力してください</p>
                      ) : null}
                    </label>

                    <label className="grid gap-2 text-sm">
                      <span>
                        使用言語 <span className="text-[11px] text-rose-700">必須</span>
                      </span>
                      <select
                        className="rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] px-3 py-2.5 outline-none transition focus:border-[#ad2218]"
                        value={expandedRoomDraft.guestLanguage}
                        onChange={(event) =>
                          setCheckInDrafts((current) => ({
                            ...current,
                            [expandedRoom.room.id]: {
                              ...(current[expandedRoom.room.id] ?? emptyCheckInDraft),
                              guestLanguage: event.target.value,
                            },
                          }))
                        }
                      >
                        {SUPPORTED_GUEST_LANGUAGE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="grid gap-2 text-sm">
                      <span>
                        チェックイン時刻 <span className="text-[11px] text-rose-700">必須</span>
                      </span>
                      <input
                        className="rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] px-3 py-2.5 outline-none transition focus:border-[#ad2218]"
                        type="datetime-local"
                        value={expandedRoomDraft.checkInAt}
                        onChange={(event) =>
                          setCheckInDrafts((current) => ({
                            ...current,
                            [expandedRoom.room.id]: {
                              ...(current[expandedRoom.room.id] ?? emptyCheckInDraft),
                              checkInAt: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>

                    <label className="grid gap-2 text-sm">
                      <span>
                        予定チェックアウト時刻 <span className="text-[11px] text-rose-700">必須</span>
                      </span>
                      <input
                        className="rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] px-3 py-2.5 outline-none transition focus:border-[#ad2218]"
                        type="datetime-local"
                        value={expandedRoomDraft.scheduledCheckOutAt}
                        onChange={(event) =>
                          setCheckInDrafts((current) => ({
                            ...current,
                            [expandedRoom.room.id]: {
                              ...(current[expandedRoom.room.id] ?? emptyCheckInDraft),
                              scheduledCheckOutAt: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>

                    {expandedRoomValidation.hasValidCheckInAt &&
                    expandedRoomValidation.hasValidScheduledCheckOutAt &&
                    !expandedRoomValidation.hasValidTimeOrder ? (
                      <p className="text-xs text-rose-700 sm:col-span-2">
                        チェックアウト時刻はチェックイン時刻より後にしてください
                      </p>
                    ) : null}

                    <label className="grid gap-2 text-sm">
                      <span>
                        ゲスト名 <span className="text-[11px] text-stone-500">任意</span>
                      </span>
                      <input
                        className="rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] px-3 py-2.5 outline-none transition focus:border-[#ad2218]"
                        value={expandedRoomDraft.guestName}
                        onChange={(event) =>
                          setCheckInDrafts((current) => ({
                            ...current,
                            [expandedRoom.room.id]: {
                              ...(current[expandedRoom.room.id] ?? emptyCheckInDraft),
                              guestName: event.target.value,
                            },
                          }))
                        }
                        placeholder="例) Emily Carter"
                      />
                    </label>

                    <label className="grid gap-2 text-sm sm:col-span-2">
                      <span>
                        メモ <span className="text-[11px] text-stone-500">任意</span>
                      </span>
                      <textarea
                        className="rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] px-3 py-2.5 outline-none transition focus:border-[#ad2218]"
                        rows={3}
                        value={expandedRoomDraft.notes}
                        onChange={(event) =>
                          setCheckInDrafts((current) => ({
                            ...current,
                            [expandedRoom.room.id]: {
                              ...(current[expandedRoom.room.id] ?? emptyCheckInDraft),
                              notes: event.target.value,
                            },
                          }))
                        }
                        placeholder="到着予定が遅い、アレルギー対応など運用メモを入力"
                      />
                    </label>
                  </div>

                  <footer className="flex items-center justify-end gap-2 border-t border-[#ecd2cf] px-5 py-4 sm:px-6">
                    <button
                      type="button"
                      className="rounded-[8px] border border-[#ecd2cf] px-4 py-2 text-sm text-stone-600 transition hover:bg-[#fff8f7]"
                      onClick={() => setExpandedRoomId(null)}
                    >
                      閉じる
                    </button>
                    <button
                      type="button"
                      className="rounded-[8px] bg-[#ad2218] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-stone-300"
                      disabled={!isAdmin || isPending || !expandedRoomValidation.canSubmit}
                      onClick={() => void handleCheckIn(expandedRoom)}
                    >
                      この部屋を宿泊登録
                    </button>
                  </footer>
                </section>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </FrontdeskShell>
  );
}
