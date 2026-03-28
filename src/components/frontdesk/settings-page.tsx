"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { HotelAuthCard } from "@/components/auth/hotel-auth-card";
import { FrontdeskShell } from "@/components/frontdesk/frontdesk-shell";
import { useHotelAuth } from "@/hooks/useHotelAuth";
import { FRONTDESK_NOTIFICATION_ENABLED_KEY } from "@/lib/frontdesk/preferences";

export function FrontdeskSettingsPage() {
  const { user, claims, isLoading: authLoading, error: authError, login, logout } = useHotelAuth();
  const [notificationEnabled, setNotificationEnabled] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }

    return window.localStorage.getItem(FRONTDESK_NOTIFICATION_ENABLED_KEY) !== "false";
  });
  const [compactMode, setCompactMode] = useState(false);

  const role = claims?.role;
  const staffUserId = useDeferredValue(user?.uid ?? "");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(FRONTDESK_NOTIFICATION_ENABLED_KEY, String(notificationEnabled));
  }, [notificationEnabled]);

  async function handleToggleNotifications() {
    const nextValue = !notificationEnabled;
    setNotificationEnabled(nextValue);

    if (
      nextValue &&
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      await Notification.requestPermission();
    }
  }

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

  return (
    <FrontdeskShell
      pageSubtitle="通知、画面表示、アカウント情報などの運用設定をまとめます。"
      pageTitle="設定"
      onLogout={() => logout()}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-950">表示設定</h3>
          <div className="mt-4 space-y-4">
            <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div>
                <p className="font-medium text-slate-950">通知を有効化</p>
                <p className="text-sm text-slate-500">着信や有人チャットの通知を受け取ります。</p>
              </div>
              <input type="checkbox" checked={notificationEnabled} onChange={() => void handleToggleNotifications()} />
            </label>
            <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div>
                <p className="font-medium text-slate-950">コンパクト表示</p>
                <p className="text-sm text-slate-500">一覧の余白を詰めて一度に多くの案件を表示します。</p>
              </div>
              <input type="checkbox" checked={compactMode} onChange={() => setCompactMode((value) => !value)} />
            </label>
          </div>
        </section>

        <aside className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-950">アカウント情報</h3>
          <div className="mt-4 space-y-3 text-sm">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-slate-500">role</div>
              <div className="mt-1 font-medium text-slate-950">{role ?? "未設定"}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-slate-500">hotel_id</div>
              <div className="mt-1 truncate font-medium text-slate-950">{claims?.hotel_id ?? "未設定"}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-slate-500">staff_user_id</div>
              <div className="mt-1 truncate font-medium text-slate-950">{staffUserId}</div>
            </div>
          </div>
        </aside>
      </div>
    </FrontdeskShell>
  );
}
