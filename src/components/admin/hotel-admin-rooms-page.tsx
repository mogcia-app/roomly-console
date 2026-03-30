"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { HotelAuthCard } from "@/components/auth/hotel-auth-card";
import { useHotelAdminRooms } from "@/hooks/useHotelAdminRooms";
import { useHotelAuth } from "@/hooks/useHotelAuth";
import { getFirebaseAuth } from "@/lib/firebase";
import type { RoomRecord } from "@/lib/frontdesk/types";
import { formatRoomLabel } from "@/lib/frontdesk/format";

type ActionState = {
  kind: "success" | "error";
  message: string;
} | null;

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

export function HotelAdminRoomsPage() {
  const { user, claims, isLoading: authLoading, error: authError, login, logout } = useHotelAuth();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [actionState, setActionState] = useState<ActionState>(null);
  const [isPending, startTransition] = useTransition();

  const role = claims?.role;
  const hotelId = claims?.hotel_id ?? "";
  const isAdmin = role === "hotel_admin";
  const roomsQuery = useHotelAdminRooms(Boolean(user && isAdmin));

  useEffect(() => {
    if (!roomsQuery.rooms.length) {
      return;
    }

    setDrafts((current) => {
      const nextDrafts = { ...current };

      for (const room of roomsQuery.rooms) {
        if (!(room.id in nextDrafts)) {
          nextDrafts[room.id] = room.display_name ?? "";
        }
      }

      return nextDrafts;
    });
  }, [roomsQuery.rooms]);

  const sortedRooms = useMemo(() => roomsQuery.rooms, [roomsQuery.rooms]);

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

  return (
    <AdminShell>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="grid gap-4 rounded-[20px] border border-[#ecd2cf] bg-white/92 p-5 shadow-[0_20px_60px_rgba(72,32,28,0.08)] md:grid-cols-[1.6fr_1fr]">
          <div className="space-y-2">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-[#ad2218]">Roomly Hotel Admin</p>
            <h1 className="text-3xl font-semibold tracking-tight text-stone-950">客室表示名の管理</h1>
            <p className="max-w-2xl text-sm leading-6 text-stone-600">
              部屋番号はそのままにして 現場向け表示名だけを設定できます
            </p>
          </div>

          <div className="grid gap-3 rounded-[16px] bg-[#ad2218] p-4 text-white">
            <div className="grid gap-1 text-sm">
              <span className="text-white/70">hotel_id</span>
              <div className="rounded-[8px] border border-white/20 bg-black/10 px-3 py-2">
                {hotelId || "未設定"}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-white/80">
              <span>role: {role ?? "未設定"}</span>
              <button
                type="button"
                className="rounded-[8px] border border-white/20 px-3 py-1 transition hover:bg-white/10"
                onClick={() => logout()}
              >
                ログアウト
              </button>
            </div>
          </div>
        </header>

        {!isAdmin ? (
          <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            この画面には `hotel_admin` 権限が必要です 現在の role: {role ?? "未設定"}
          </div>
        ) : null}

        {actionState ? (
          <div
            className={`rounded-[12px] border px-4 py-3 text-sm ${
              actionState.kind === "success"
                ? "border-[#e7c0bb] bg-[#fff1ef] text-[#ad2218]"
                : "border-rose-200 bg-rose-50 text-rose-900"
            }`}
          >
            {actionState.message}
          </div>
        ) : null}

        <section className="rounded-[20px] border border-[#ecd2cf] bg-white/88 p-5 shadow-[0_18px_50px_rgba(72,32,28,0.06)]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">客室一覧</h2>
              <p className="text-sm text-stone-500">表示名がある場合は {`101 (梅の部屋)`} の形式で使われます</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-[8px] border border-[#ecd2cf] px-3 py-2 text-sm transition hover:bg-[#fff8f7]"
                onClick={() => void roomsQuery.refresh()}
              >
                再読込
              </button>
            </div>
          </div>

          {roomsQuery.error ? <p className="mb-4 text-sm text-rose-700">{roomsQuery.error}</p> : null}
          {roomsQuery.isLoading ? <p className="text-sm text-stone-500">客室一覧を読み込み中です</p> : null}

          <div className="space-y-3">
            {sortedRooms.map((room) => {
              const draftValue = drafts[room.id] ?? room.display_name ?? "";
              const normalizedDraft = draftValue.trim();
              const normalizedCurrent = room.display_name?.trim() ?? "";
              const isDirty = normalizedDraft !== normalizedCurrent;

              return (
                <article
                  key={room.id}
                  className="grid gap-3 rounded-[10px] border border-[#ecd2cf] bg-[#fff8f7] p-4 lg:grid-cols-[140px_minmax(0,1fr)_110px]"
                >
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-stone-400">部屋番号</p>
                    <p className="mt-2 text-lg font-semibold text-stone-950">{room.room_number}</p>
                  </div>

                  <div className="grid gap-2">
                    <label className="grid gap-2 text-sm">
                      <span className="text-stone-600">表示名</span>
                      <input
                        className="rounded-[8px] border border-[#ecd2cf] bg-white px-3 py-3 outline-none transition focus:border-[#ad2218]"
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
                    <p className="text-xs text-stone-500">表示例: {formatRoomLabel(room.room_id, room.room_number, normalizedDraft || null)}</p>
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button"
                      className="w-full rounded-[8px] bg-[#ad2218] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-stone-300"
                      disabled={!isAdmin || isPending || !isDirty}
                      onClick={() => void handleSave(room)}
                    >
                      保存
                    </button>
                  </div>
                </article>
              );
            })}

            {!roomsQuery.isLoading && sortedRooms.length === 0 ? (
              <p className="rounded-[10px] bg-[#fff8f7] px-4 py-5 text-sm text-stone-500">客室データがまだありません</p>
            ) : null}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
