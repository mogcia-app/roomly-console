"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { HotelAuthCard } from "@/components/auth/hotel-auth-card";
import { FrontdeskShell } from "@/components/frontdesk/frontdesk-shell";
import { useHotelAdminRoomStatuses } from "@/hooks/useHotelAdminRoomStatuses";
import { useHotelAuth } from "@/hooks/useHotelAuth";
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
  const [actionState, setActionState] = useState<ActionState>(null);
  const [isPending, startTransition] = useTransition();

  const role = claims?.role;
  const isAdmin = role === "hotel_admin";
  const roomsQuery = useHotelAdminRoomStatuses(Boolean(user && isAdmin));
  const sortedRooms = useMemo(() => roomsQuery.rooms, [roomsQuery.rooms]);
  const summary = useMemo(
    () => ({
      vacant: sortedRooms.filter((item) => item.status === "vacant").length,
      occupied: sortedRooms.filter((item) => item.status === "occupied").length,
      conflict: sortedRooms.filter((item) => item.status === "conflict").length,
    }),
    [sortedRooms],
  );

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
    const guestCount = Number.parseInt(draft.guestCount, 10);

    setActionState(null);

    startTransition(async () => {
      try {
        const response = await authorizedFetch("/api/admin/stays/check-in", {
          method: "POST",
          body: JSON.stringify({
            roomId: room.room_id,
            guestCount,
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
      fixedHeader
      pageSubtitle="部屋ごとの宿泊登録とチェックアウトにあわせて、客室QRの利用状態を管理します"
      pageTitle="客室滞在管理"
      onLogout={() => logout()}
      role={role}
    >
      <div className="flex min-h-screen w-full flex-col gap-4 px-3 py-4 sm:px-4 lg:px-5">
        {!isAdmin ? (
          <div className="rounded-none border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            この画面には `hotel_admin` 権限が必要です 現在の role: {role ?? "未設定"}
          </div>
        ) : null}

        {actionState ? (
          <div
            className={`rounded-none border px-4 py-3 text-sm ${
              actionState.kind === "success"
                ? "border-[#e7c0bb] bg-[#fff1ef] text-[#ad2218]"
                : "border-rose-200 bg-rose-50 text-rose-900"
            }`}
          >
            {actionState.message}
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-none border border-stone-200 bg-white px-4 py-4 shadow-sm">
            <p className="text-xs font-medium text-stone-500">空室</p>
            <p className="mt-1 text-2xl font-semibold text-stone-950">{summary.vacant}</p>
          </div>
          <div className="rounded-none border border-stone-200 bg-white px-4 py-4 shadow-sm">
            <p className="text-xs font-medium text-stone-500">滞在中</p>
            <p className="mt-1 text-2xl font-semibold text-stone-950">{summary.occupied}</p>
          </div>
          <div className="rounded-none border border-stone-200 bg-white px-4 py-4 shadow-sm">
            <p className="text-xs font-medium text-stone-500">要確認</p>
            <p className="mt-1 text-2xl font-semibold text-stone-950">{summary.conflict}</p>
          </div>
        </section>

        <section className="rounded-none border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-stone-950">客室一覧</h2>
              <p className="text-sm text-stone-500">部屋を宿泊登録すると客室QRが使えるようになり、チェックアウトすると使えなくなります</p>
            </div>
            <button
              type="button"
              className="rounded-none border border-stone-200 px-3 py-2 text-sm text-stone-600 transition hover:bg-stone-50"
              onClick={() => void roomsQuery.refresh()}
            >
              再読込
            </button>
          </div>

          {roomsQuery.error ? <p className="mb-4 text-sm text-rose-700">{roomsQuery.error}</p> : null}
          {roomsQuery.isLoading ? <p className="text-sm text-stone-500">客室一覧を読み込み中です</p> : null}

          <div className="space-y-3">
            {sortedRooms.map((item) => {
              const room = item.room;
              const activeStay = item.active_stay ?? null;
              const draftValue = drafts[room.id] ?? room.display_name ?? "";
              const normalizedDraft = draftValue.trim();
              const normalizedCurrent = room.display_name?.trim() ?? "";
              const isDirty = normalizedDraft !== normalizedCurrent;
              const checkInDraft = checkInDrafts[room.id] ?? emptyCheckInDraft;

              return (
                <article key={room.id} className="rounded-none border border-stone-200 bg-stone-50/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-stone-950">{room.room_number}</h3>
                        <span className={`rounded-none px-2.5 py-1 text-xs font-semibold ${occupancyTone(item.status)}`}>
                          {occupancyLabel(item.status)}
                        </span>
                        {room.floor ? (
                          <span className="rounded-none bg-white px-2.5 py-1 text-xs text-stone-500">{room.floor}階</span>
                        ) : null}
                      </div>
                      {room.display_name?.trim() ? (
                        <p className="mt-1 text-sm text-stone-500">
                          {formatRoomLabel(room.room_id, room.room_number, room.display_name)}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-none border border-stone-200 bg-white px-2 py-1 text-[11px] text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                        disabled={!isAdmin || isPending}
                        onClick={() => setExpandedRoomId((current) => (current === room.id ? null : room.id))}
                      >
                        宿泊登録
                      </button>
                      <button
                        type="button"
                        className="rounded-none border border-stone-200 bg-white px-2 py-1 text-[11px] text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                        disabled={!isAdmin || isPending}
                        onClick={() => void handleCheckOut(item)}
                      >
                        チェックアウト
                      </button>
                    </div>
                  </div>

                  <dl className="mt-4 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <dt className="text-xs text-stone-400">チェックイン</dt>
                      <dd className="mt-1 text-stone-700">{formatDateTime(activeStay?.check_in_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-stone-400">予定チェックアウト</dt>
                      <dd className="mt-1 text-stone-700">{formatDateTime(activeStay?.scheduled_check_out_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-stone-400">宿泊人数</dt>
                      <dd className="mt-1 text-stone-700">{infoValue(activeStay?.guest_count)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-stone-400">使用言語</dt>
                      <dd className="mt-1 text-stone-700">
                        {activeStay?.guest_language ? formatGuestLanguageLabel(activeStay.guest_language) : "-"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-stone-400">ゲスト名</dt>
                      <dd className="mt-1 text-stone-700">{infoValue(activeStay?.guest_name)}</dd>
                    </div>
                  </dl>

                  <div className="mt-4 grid grid-cols-[minmax(0,1fr)_56px] items-end gap-2">
                    <label className="grid gap-1.5 text-sm">
                      <span className="text-stone-500">表示名</span>
                      <input
                        className="h-7 rounded-none border border-stone-200 bg-white px-3 py-0 text-sm outline-none transition focus:border-stone-400"
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
                      className="h-7 w-14 rounded-none border border-stone-200 bg-white px-1 py-0 text-[10px] leading-none text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100"
                      disabled={!isAdmin || isPending || !isDirty}
                      onClick={() => void handleSave(room)}
                    >
                      保存
                    </button>
                  </div>

                  {item.status === "conflict" ? (
                    <p className="mt-4 rounded-none border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      active stay が複数あります。最新 1 件に寄せず、要確認として扱っています。
                    </p>
                  ) : null}

                  {expandedRoomId === room.id ? (
                    <div className="mt-4 grid gap-3 rounded-none border border-stone-200 bg-white p-4 lg:grid-cols-2">
                      <div className="lg:col-span-2">
                        <h4 className="text-sm font-semibold text-stone-900">宿泊登録</h4>
                        <p className="mt-1 text-xs text-stone-500">必要な項目を入力して、この部屋の宿泊情報を登録します。</p>
                      </div>
                      <label className="grid gap-2 text-sm">
                        <span>宿泊人数</span>
                        <input
                          className="rounded-none border border-stone-200 px-3 py-2.5 outline-none transition focus:border-stone-400"
                          inputMode="numeric"
                          value={checkInDraft.guestCount}
                          onChange={(event) =>
                            setCheckInDrafts((current) => ({
                              ...current,
                              [room.id]: {
                                ...(current[room.id] ?? emptyCheckInDraft),
                                guestCount: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span>使用言語</span>
                        <select
                          className="rounded-none border border-stone-200 bg-white px-3 py-2.5 outline-none transition focus:border-stone-400"
                          value={checkInDraft.guestLanguage}
                          onChange={(event) =>
                            setCheckInDrafts((current) => ({
                              ...current,
                              [room.id]: {
                                ...(current[room.id] ?? emptyCheckInDraft),
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
                        <span>チェックイン時刻</span>
                        <input
                          className="rounded-none border border-stone-200 px-3 py-2.5 outline-none transition focus:border-stone-400"
                          type="datetime-local"
                          value={checkInDraft.checkInAt}
                          onChange={(event) =>
                            setCheckInDrafts((current) => ({
                              ...current,
                              [room.id]: {
                                ...(current[room.id] ?? emptyCheckInDraft),
                                checkInAt: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span>予定チェックアウト時刻</span>
                        <input
                          className="rounded-none border border-stone-200 px-3 py-2.5 outline-none transition focus:border-stone-400"
                          type="datetime-local"
                          value={checkInDraft.scheduledCheckOutAt}
                          onChange={(event) =>
                            setCheckInDrafts((current) => ({
                              ...current,
                              [room.id]: {
                                ...(current[room.id] ?? emptyCheckInDraft),
                                scheduledCheckOutAt: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span>ゲスト名</span>
                        <input
                          className="rounded-none border border-stone-200 px-3 py-2.5 outline-none transition focus:border-stone-400"
                          value={checkInDraft.guestName}
                          onChange={(event) =>
                            setCheckInDrafts((current) => ({
                              ...current,
                              [room.id]: {
                                ...(current[room.id] ?? emptyCheckInDraft),
                                guestName: event.target.value,
                              },
                            }))
                          }
                          placeholder="Optional"
                        />
                      </label>
                      <label className="grid gap-2 text-sm lg:col-span-2">
                        <span>メモ</span>
                        <input
                          className="rounded-none border border-stone-200 px-3 py-2.5 outline-none transition focus:border-stone-400"
                          value={checkInDraft.notes}
                          onChange={(event) =>
                            setCheckInDrafts((current) => ({
                              ...current,
                              [room.id]: {
                                ...(current[room.id] ?? emptyCheckInDraft),
                                notes: event.target.value,
                              },
                            }))
                          }
                          placeholder="Optional"
                        />
                      </label>

                      <div className="flex items-center justify-end gap-2 lg:col-span-2">
                        <button
                          type="button"
                          className="rounded-none border border-stone-200 px-4 py-2 text-sm text-stone-600 transition hover:bg-stone-50"
                          onClick={() => setExpandedRoomId(null)}
                        >
                          閉じる
                        </button>
                        <button
                          type="button"
                          className="rounded-none bg-stone-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                          disabled={!isAdmin || isPending}
                          onClick={() => void handleCheckIn(item)}
                        >
                          この部屋を宿泊登録
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}

            {!roomsQuery.isLoading && sortedRooms.length === 0 ? (
              <p className="rounded-none border border-dashed border-stone-200 bg-stone-50 px-4 py-6 text-sm text-stone-500">
                客室データがまだありません
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </FrontdeskShell>
  );
}
