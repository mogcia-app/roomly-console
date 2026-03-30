"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { HotelAuthCard } from "@/components/auth/hotel-auth-card";
import { useHotelAdminStaff } from "@/hooks/useHotelAdminStaff";
import { buildInquiryHistory, useHotelRooms, useRecentThreads } from "@/hooks/useFrontdeskData";
import { useHotelAuth } from "@/hooks/useHotelAuth";
import { getFirebaseAuth } from "@/lib/firebase";
import { formatInquiryType, formatIsoDateTime, formatRoomLabel, formatStatusLabel } from "@/lib/frontdesk/format";

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

export function HotelAdminConsole() {
  const { user, claims, isLoading: authLoading, error: authError, login, logout } = useHotelAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [actionState, setActionState] = useState<ActionState>(null);
  const [isPending, startTransition] = useTransition();

  const role = claims?.role;
  const hotelId = claims?.hotel_id ?? "";
  const isAdmin = role === "hotel_admin";
  const staffQuery = useHotelAdminStaff(Boolean(user && isAdmin));
  const recentThreads = useRecentThreads(hotelId);
  const hotelRooms = useHotelRooms(hotelId);
  const inquiryHistory = useMemo(() => buildInquiryHistory(recentThreads.data).slice(0, 30), [recentThreads.data]);
  const roomDisplayNames = useMemo(
    () => new Map(hotelRooms.data.map((room) => [room.room_id || room.id, room.display_name ?? null])),
    [hotelRooms.data],
  );

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

  async function handleCreateStaff(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionState(null);

    startTransition(async () => {
      try {
        const response = await authorizedFetch("/api/admin/staff", {
          method: "POST",
          body: JSON.stringify({
            displayName,
            email,
            password,
            role: "hotel_front",
          }),
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "failed-to-create-staff");
        }

        setDisplayName("");
        setEmail("");
        setPassword("");
        await staffQuery.refresh();
        setActionState({ kind: "success", message: "hotel_front アカウントを作成しました。" });
      } catch (error) {
        setActionState({
          kind: "error",
          message: error instanceof Error ? error.message : "failed-to-create-staff",
        });
      }
    });
  }

  async function handleToggleActive(targetUid: string, isActive: boolean) {
    setActionState(null);

    startTransition(async () => {
      try {
        const response = await authorizedFetch(`/api/admin/staff/${targetUid}`, {
          method: "PATCH",
          body: JSON.stringify({ isActive }),
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "failed-to-update-staff");
        }

        await staffQuery.refresh();
        setActionState({
          kind: "success",
          message: isActive ? "スタッフを再有効化しました。" : "スタッフを無効化しました。",
        });
      } catch (error) {
        setActionState({
          kind: "error",
          message: error instanceof Error ? error.message : "failed-to-update-staff",
        });
      }
    });
  }

  return (
    <AdminShell>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="grid gap-4 rounded-[28px] border border-white/70 bg-white/85 p-5 shadow-[0_20px_60px_rgba(43,51,43,0.08)] backdrop-blur md:grid-cols-[1.6fr_1fr]">
          <div className="space-y-2">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-800">Roomly Hotel Admin</p>
            <h1 className="text-3xl font-semibold tracking-tight text-stone-950">スタッフ管理をホテル側で完結</h1>
            <p className="max-w-2xl text-sm leading-6 text-stone-600">
              `users/{'{uid}'}` を正規プロフィールとし、Firebase Auth のメールユーザー作成、custom claims 付与、無効化までを
              `hotel_admin` から操作します。
            </p>
          </div>

          <div className="grid gap-3 rounded-[24px] bg-stone-950 p-4 text-stone-50">
            <div className="grid gap-1 text-sm">
              <span className="text-stone-300">hotel_id</span>
              <div className="rounded-2xl border border-stone-700 bg-stone-900 px-3 py-2 text-stone-100">
                {hotelId || "未設定"}
              </div>
            </div>
            <div className="grid gap-1 text-sm">
              <span className="text-stone-300">admin_uid</span>
              <div className="rounded-2xl border border-stone-700 bg-stone-900 px-3 py-2 text-stone-100">
                {user.uid}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-stone-300">
              <span>role: {role ?? "未設定"}</span>
              <button
                type="button"
                className="rounded-full border border-stone-700 px-3 py-1 transition hover:border-cyan-500"
                onClick={() => logout()}
              >
                ログアウト
              </button>
            </div>
          </div>
        </header>

        {!isAdmin ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            この画面には `hotel_admin` の custom claim が必要です。現在の role: {role ?? "未設定"}
          </div>
        ) : null}

        {actionState ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              actionState.kind === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-rose-200 bg-rose-50 text-rose-900"
            }`}
          >
            {actionState.message}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
          <section className="rounded-[28px] border border-white/60 bg-white/80 p-5 shadow-[0_18px_50px_rgba(43,51,43,0.06)] backdrop-blur">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">hotel_front 追加</h2>
              <p className="text-sm text-stone-500">作成時に Firebase Auth と `users/{'{uid}'}` を同時に更新します。</p>
            </div>

            <form className="grid gap-4" onSubmit={handleCreateStaff}>
              <label className="grid gap-1 text-sm">
                <span>表示名</span>
                <input
                  className="rounded-2xl border border-stone-300 bg-white px-3 py-3 outline-none transition focus:border-cyan-600"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="安藤 里奈"
                  required
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span>メールアドレス</span>
                <input
                  className="rounded-2xl border border-stone-300 bg-white px-3 py-3 outline-none transition focus:border-cyan-600"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="front-1@example.com"
                  required
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span>初期パスワード</span>
                <input
                  className="rounded-2xl border border-stone-300 bg-white px-3 py-3 outline-none transition focus:border-cyan-600"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="8文字以上推奨"
                  minLength={8}
                  required
                />
              </label>

              <button
                type="submit"
                className="rounded-2xl bg-cyan-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                disabled={!isAdmin || isPending}
              >
                スタッフを追加
              </button>
            </form>

            <div className="mt-6 rounded-[24px] bg-stone-950 p-4 text-sm text-stone-200">
              <p className="font-medium text-white">users スキーマ案</p>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-stone-300">
                <li>`email`, `display_name`, `role`, `hotel_id`, `is_active` を必須に近い扱いにする。</li>
                <li>`created_at`, `updated_at`, `disabled_at`, `disabled_by`, `last_sign_in_at` を運用ログとして保持する。</li>
                <li>`staff_user_id` は `uid` をそのまま使う。</li>
              </ul>
            </div>
          </section>

          <section className="rounded-[28px] border border-white/60 bg-white/80 p-5 shadow-[0_18px_50px_rgba(43,51,43,0.06)] backdrop-blur">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">スタッフ一覧</h2>
                <p className="text-sm text-stone-500">同一 `hotel_id` のユーザーのみ表示します。</p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  className="rounded-full border border-stone-300 px-3 py-2 text-sm transition hover:border-cyan-600"
                  href="/"
                >
                  フロント画面へ
                </Link>
                <button
                  type="button"
                  className="rounded-full border border-stone-300 px-3 py-2 text-sm transition hover:border-cyan-600"
                  onClick={() => void staffQuery.refresh()}
                >
                  再読込
                </button>
              </div>
            </div>

            {staffQuery.error ? <p className="mb-4 text-sm text-rose-700">{staffQuery.error}</p> : null}
            {staffQuery.isLoading ? <p className="text-sm text-stone-500">スタッフ一覧を読み込み中です。</p> : null}

            <div className="space-y-3">
              {staffQuery.staff.map((staff) => (
                <article key={staff.id} className="rounded-[24px] border border-stone-200 bg-stone-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-base font-semibold text-stone-900">{staff.display_name || "名称未設定"}</p>
                      <p className="text-sm text-stone-600">{staff.email}</p>
                      <p className="mt-1 font-mono text-xs text-stone-500">{staff.id}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          staff.is_active ? "bg-emerald-100 text-emerald-900" : "bg-stone-200 text-stone-700"
                        }`}
                      >
                        {staff.is_active ? "active" : "disabled"}
                      </span>
                      <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-xs font-semibold text-cyan-900">
                        {staff.role}
                      </span>
                    </div>
                  </div>

                  <dl className="mt-4 grid gap-2 text-sm text-stone-600 sm:grid-cols-2">
                    <div className="flex justify-between gap-2">
                      <dt>ホテル</dt>
                      <dd>{staff.hotel_id}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>作成日時</dt>
                      <dd>{formatIsoDateTime(staff.created_at)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>更新日時</dt>
                      <dd>{formatIsoDateTime(staff.updated_at)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>最終サインイン</dt>
                      <dd>{staff.last_sign_in_at ?? "未取得"}</dd>
                    </div>
                  </dl>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-2xl border border-stone-300 px-4 py-2 text-sm transition hover:border-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!isAdmin || isPending || staff.role === "hotel_admin"}
                      onClick={() => void handleToggleActive(staff.id, !staff.is_active)}
                    >
                      {staff.is_active ? "無効化" : "再有効化"}
                    </button>
                  </div>
                </article>
              ))}

              {!staffQuery.isLoading && staffQuery.staff.length === 0 ? (
                <p className="rounded-2xl bg-stone-100 px-4 py-5 text-sm text-stone-500">スタッフがまだ作成されていません。</p>
              ) : null}
            </div>
          </section>
        </div>

        <section className="rounded-[28px] border border-white/60 bg-white/80 p-5 shadow-[0_18px_50px_rgba(43,51,43,0.06)] backdrop-blur">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">問い合わせ履歴</h2>
              <p className="text-sm text-stone-500">
                `chat_threads(mode=human)` を部屋番号・状態・緊急で追えるようにしています。
              </p>
            </div>
            <div className="text-sm text-stone-500">{inquiryHistory.length}件表示</div>
          </div>

          {recentThreads.error ? <p className="mb-4 text-sm text-rose-700">{recentThreads.error}</p> : null}

          <div className="space-y-3">
            {inquiryHistory.map((item) => (
              <article key={`${item.source}-${item.id}`} className="rounded-[24px] border border-stone-200 bg-stone-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-base font-semibold text-stone-900">
                        {formatRoomLabel(item.room_id, item.room_number, item.room_display_name ?? roomDisplayNames.get(item.room_id))}
                      </p>
                      {item.emergency ? (
                        <span className="rounded-full bg-rose-100 px-2 py-1 text-[11px] font-semibold text-rose-800">
                          緊急
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-stone-600">
                      {formatInquiryType(item.event_type, item.source)} / {item.guest_language ?? "言語未設定"}
                    </p>
                    <p className="mt-1 font-mono text-xs text-stone-500">{item.stay_id}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-800">
                      {item.source}
                    </span>
                    <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-xs font-semibold text-cyan-900">
                      {formatStatusLabel(item.status)}
                    </span>
                  </div>
                </div>

                <dl className="mt-4 grid gap-2 text-sm text-stone-600 md:grid-cols-3">
                  <div className="flex justify-between gap-2">
                    <dt>発生</dt>
                    <dd>{formatIsoDateTime(item.created_at?.toDate().toISOString())}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>対応開始</dt>
                    <dd>{formatIsoDateTime(item.started_at?.toDate().toISOString())}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>終了/完了</dt>
                    <dd>{formatIsoDateTime(item.resolved_at?.toDate().toISOString())}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>担当者</dt>
                    <dd>{item.assigned_to ?? "未設定"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>カテゴリ</dt>
                    <dd>{item.category ?? "-"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>最終更新</dt>
                    <dd>{formatIsoDateTime(item.updated_at?.toDate().toISOString())}</dd>
                  </div>
                </dl>
              </article>
            ))}

            {!recentThreads.isLoading && inquiryHistory.length === 0 ? (
              <p className="rounded-2xl bg-stone-100 px-4 py-5 text-sm text-stone-500">問い合わせ履歴はまだありません。</p>
            ) : null}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
