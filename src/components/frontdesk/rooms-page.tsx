"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { HotelAuthCard } from "@/components/auth/hotel-auth-card";
import { FrontdeskAuthLoading } from "@/components/frontdesk/frontdesk-auth-loading";
import { FrontdeskShell } from "@/components/frontdesk/frontdesk-shell";
import { useHotelAdminRooms } from "@/hooks/useHotelAdminRooms";
import { useHotelAuth } from "@/hooks/useHotelAuth";
import { useCompactModePreference } from "@/hooks/useFrontdeskPreferences";
import { getFirebaseAuth } from "@/lib/firebase";
import { formatRoomLabel } from "@/lib/frontdesk/format";
import type { RoomRecord } from "@/lib/frontdesk/types";

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

export function FrontdeskRoomsPage() {
  const { user, claims, isLoading: authLoading, error: authError, login, logout } = useHotelAuth();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [actionState, setActionState] = useState<ActionState>(null);
  const [isPending, startTransition] = useTransition();
  const [compactMode] = useCompactModePreference();

  const role = claims?.role;
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
    <FrontdeskShell
      compactMode={compactMode}
      fixedHeader
      pageSubtitle="客室の表示名を編集できます"
      pageTitle="客室表示名"
      onLogout={() => logout()}
      role={role}
    >
      <div className={`min-h-0 flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 ${compactMode ? "py-4" : "py-5"}`}>
        {!isAdmin ? (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            この画面は hotel_admin 権限のあるアカウントで利用できます
          </div>
        ) : null}

        {actionState ? (
          <div
            className={`mt-4 rounded-[10px] border px-4 py-3 text-sm ${
              actionState.kind === "success"
                ? "border-[#e7c0bb] bg-[#fff1ef] text-[#ad2218]"
                : "border-rose-200 bg-rose-50 text-rose-900"
            }`}
          >
            {actionState.message}
          </div>
        ) : null}

        <section className="mt-4 overflow-hidden rounded-[10px] border border-[#ecd2cf] bg-[#fff8f7] shadow-[0_12px_30px_rgba(72,32,28,0.06)]">
          <div className="border-b border-[#ecd2cf] bg-white px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ad2218]">Rooms</p>
                <h3 className="mt-2 text-xl font-semibold text-stone-950">客室一覧</h3>
                <p className="mt-2 text-sm leading-6 text-stone-500">
                  部屋番号はそのままにして 表示名だけを設定できます
                </p>
              </div>
              <button
                type="button"
                className="rounded-[8px] border border-[#ecd2cf] px-3 py-2 text-sm transition hover:bg-[#fff8f7]"
                onClick={() => void roomsQuery.refresh()}
              >
                再読込
              </button>
            </div>
          </div>

          <div className="space-y-3 p-4 sm:p-5">
            {roomsQuery.error ? <p className="text-sm text-rose-700">{roomsQuery.error}</p> : null}
            {roomsQuery.isLoading ? <p className="text-sm text-stone-500">客室一覧を読み込み中です</p> : null}

            {sortedRooms.map((room) => {
              const draftValue = drafts[room.id] ?? room.display_name ?? "";
              const normalizedDraft = draftValue.trim();
              const normalizedCurrent = room.display_name?.trim() ?? "";
              const isDirty = normalizedDraft !== normalizedCurrent;

              return (
                <article
                  key={room.id}
                  className="grid gap-3 rounded-[8px] border border-[#ecd2cf] bg-white p-4 lg:grid-cols-[140px_minmax(0,1fr)_110px]"
                >
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-stone-400">部屋番号</p>
                    <p className="mt-2 text-lg font-semibold text-stone-950">{room.room_number}</p>
                  </div>

                  <div className="grid gap-2">
                    <label className="grid gap-2 text-sm">
                      <span className="text-stone-600">表示名</span>
                      <input
                        className="rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] px-3 py-3 outline-none transition focus:border-[#ad2218]"
                        value={draftValue}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [room.id]: event.target.value,
                          }))
                        }
                        placeholder="梅の部屋"
                        disabled={!isAdmin}
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
              <p className="rounded-[8px] border border-dashed border-[#ecd2cf] bg-white px-4 py-5 text-sm text-stone-500">
                客室データがまだありません
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </FrontdeskShell>
  );
}
