"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { HotelAuthCard } from "@/components/auth/hotel-auth-card";
import { FrontdeskShell } from "@/components/frontdesk/frontdesk-shell";
import { useHotelAuth } from "@/hooks/useHotelAuth";
import { getFirebaseAuth } from "@/lib/firebase";
import { FRONTDESK_NOTIFICATION_ENABLED_KEY } from "@/lib/frontdesk/preferences";

function SettingToggle({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between gap-4 rounded-[8px] border border-[#ecd2cf] bg-white px-4 py-4 text-left transition hover:bg-[#fff8f7]"
      onClick={onChange}
      aria-pressed={checked}
    >
      <div>
        <p className="font-medium text-stone-950">{label}</p>
        <p className="mt-1 text-sm leading-6 text-stone-500">{description}</p>
      </div>
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${
          checked ? "bg-[#ad2218]" : "bg-[#e7d8d5]"
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </span>
    </button>
  );
}

function InfoCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[8px] border border-[#ecd2cf] bg-white px-4 py-4">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">{label}</div>
      <div className="mt-2 truncate text-sm font-medium text-stone-950">{value}</div>
    </div>
  );
}

export function FrontdeskSettingsPage() {
  const { user, claims, isLoading: authLoading, error: authError, login, logout } = useHotelAuth();
  const [notificationEnabled, setNotificationEnabled] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }

    return window.localStorage.getItem(FRONTDESK_NOTIFICATION_ENABLED_KEY) !== "false";
  });
  const [compactMode, setCompactMode] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [passwordActionMessage, setPasswordActionMessage] = useState<string | null>(null);
  const [passwordActionError, setPasswordActionError] = useState<string | null>(null);
  const [isSendingPasswordReset, setIsSendingPasswordReset] = useState(false);

  const role = claims?.role;
  const staffUserId = useDeferredValue(user?.uid ?? "");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(FRONTDESK_NOTIFICATION_ENABLED_KEY, String(notificationEnabled));
  }, [notificationEnabled]);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }

    setNotificationPermission(Notification.permission);
  }, []);

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
      setNotificationPermission(Notification.permission);
    }
  }

  async function handleSendPasswordReset() {
    if (!user?.email) {
      setPasswordActionError("メールアドレスを確認できません");
      setPasswordActionMessage(null);
      return;
    }

    setIsSendingPasswordReset(true);
    setPasswordActionError(null);
    setPasswordActionMessage(null);

    try {
      await sendPasswordResetEmail(getFirebaseAuth(), user.email);
      setPasswordActionMessage(`${user.email} にパスワード再設定メールを送信しました`);
    } catch (error) {
      setPasswordActionError(error instanceof Error ? error.message : "password-reset-failed");
    } finally {
      setIsSendingPasswordReset(false);
    }
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

  return (
    <FrontdeskShell
      fixedHeader
      pageSubtitle="通知や表示設定を見直せます"
      pageTitle="設定"
      onLogout={() => logout()}
    >
      <div className="px-4 py-5 sm:px-6 lg:px-8">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_340px]">
          <section className="overflow-hidden rounded-[10px] border border-[#ecd2cf] bg-[#fff8f7] shadow-[0_12px_30px_rgba(72,32,28,0.06)]">
            <div className="border-b border-[#ecd2cf] bg-white px-5 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ad2218]">Display</p>
              <h3 className="mt-2 text-xl font-semibold text-stone-950">画面設定</h3>
              <p className="mt-2 text-sm leading-6 text-stone-500">
                通知や表示スタイルをここで切り替えられます
              </p>
            </div>

            <div className="space-y-4 p-4 sm:p-5">
              <SettingToggle
                checked={notificationEnabled}
                label="通知を有効にする"
                description="新しいチャットや対応が必要なやり取りを通知で受け取ります"
                onChange={() => void handleToggleNotifications()}
              />
              <InfoCard
                label="通知許可"
                value={
                  notificationPermission === "granted"
                    ? "許可済み"
                    : notificationPermission === "denied"
                      ? "ブラウザ側で拒否されています"
                      : notificationPermission === "default"
                        ? "まだ確認していません"
                        : "この端末では未対応です"
                }
              />
              <SettingToggle
                checked={compactMode}
                label="コンパクト表示"
                description="一覧の余白を少し詰めて一度に見える件数を増やします"
                onChange={() => setCompactMode((value) => !value)}
              />
            </div>
          </section>

          <div className="space-y-5">
            <aside className="overflow-hidden rounded-[10px] border border-[#ecd2cf] bg-[#fff8f7] shadow-[0_12px_30px_rgba(72,32,28,0.06)]">
              <div className="border-b border-[#ecd2cf] bg-white px-5 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ad2218]">Account</p>
                <h3 className="mt-2 text-xl font-semibold text-stone-950">アカウント情報</h3>
                <p className="mt-2 text-sm leading-6 text-stone-500">
                  現在ログイン中の管理画面アカウントです
                </p>
              </div>

              <div className="space-y-3 p-4 sm:p-5">
                <InfoCard label="email" value={user.email ?? "未設定"} />
                <InfoCard label="role" value={role ?? "未設定"} />
                <InfoCard label="hotel_id" value={claims?.hotel_id ?? "未設定"} />
                <InfoCard label="staff_user_id" value={staffUserId || "未設定"} />
              </div>
            </aside>

            <section className="overflow-hidden rounded-[10px] border border-[#ecd2cf] bg-[#fff8f7] shadow-[0_12px_30px_rgba(72,32,28,0.06)]">
              <div className="border-b border-[#ecd2cf] bg-white px-5 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ad2218]">Security</p>
                <h3 className="mt-2 text-xl font-semibold text-stone-950">パスワード変更</h3>
                <p className="mt-2 text-sm leading-6 text-stone-500">
                  登録メールアドレス宛にパスワード再設定メールを送信します
                </p>
              </div>

              <div className="space-y-4 p-4 sm:p-5">
                <InfoCard label="送信先" value={user.email ?? "未設定"} />
                <button
                  type="button"
                  className="w-full rounded-[8px] bg-[#ad2218] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-stone-300"
                  onClick={() => void handleSendPasswordReset()}
                  disabled={isSendingPasswordReset || !user.email}
                >
                  {isSendingPasswordReset ? "送信中" : "パスワード再設定メールを送信"}
                </button>
                {passwordActionMessage ? (
                  <p className="rounded-[8px] border border-[#e7c0bb] bg-[#fff1ef] px-4 py-3 text-sm text-[#ad2218]">
                    {passwordActionMessage}
                  </p>
                ) : null}
                {passwordActionError ? (
                  <p className="rounded-[8px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {passwordActionError}
                  </p>
                ) : null}
              </div>
            </section>

            <section className="overflow-hidden rounded-[10px] border border-[#ecd2cf] bg-[#fff8f7] shadow-[0_12px_30px_rgba(72,32,28,0.06)]">
              <div className="border-b border-[#ecd2cf] bg-white px-5 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ad2218]">Session</p>
                <h3 className="mt-2 text-xl font-semibold text-stone-950">ログアウト</h3>
                <p className="mt-2 text-sm leading-6 text-stone-500">
                  現在の端末から管理画面をログアウトします
                </p>
              </div>

              <div className="p-4 sm:p-5">
                <button
                  type="button"
                  className="w-full rounded-[8px] border border-[#ecd2cf] bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-[#fff8f7]"
                  onClick={() => void logout()}
                >
                  ログアウト
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </FrontdeskShell>
  );
}
