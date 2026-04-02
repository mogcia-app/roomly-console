"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { HotelAuthCard } from "@/components/auth/hotel-auth-card";
import { FrontdeskShell } from "@/components/frontdesk/frontdesk-shell";
import { useHotelAuth } from "@/hooks/useHotelAuth";
import { getFirebaseAuth } from "@/lib/firebase";
import { FRONTDESK_NOTIFICATION_ENABLED_KEY } from "@/lib/frontdesk/preferences";
import { createEmptyOperationsInfo, type OperationsInfoEntry, type OperationsInfoKey, type OperationsInfoRecord } from "@/lib/frontdesk/operations-info";

type OperationsInfoResponse = {
  error?: string;
  hotelId?: string;
  operationsInfo?: OperationsInfoRecord;
};

type OperationsInfoState = {
  data: OperationsInfoRecord;
  error: string | null;
  hotelId: string;
  isLoading: boolean;
};

const initialOperationsInfoState: OperationsInfoState = {
  data: createEmptyOperationsInfo(),
  error: null,
  hotelId: "",
  isLoading: false,
};

const operationsSectionOrder: Array<{ key: OperationsInfoKey; title: string }> = [
  { key: "frontDeskHours", title: "フロント対応時間" },
  { key: "wifiNetworks", title: "Wi-Fi" },
  { key: "breakfastEntries", title: "朝食" },
  { key: "bathEntries", title: "温泉" },
  { key: "facilityEntries", title: "館内設備" },
  { key: "facilityLocationEntries", title: "館内設備の場所" },
  { key: "amenityEntries", title: "アメニティ" },
  { key: "parkingEntries", title: "駐車場" },
  { key: "emergencyEntries", title: "緊急時メモ" },
  { key: "faqEntries", title: "FAQ" },
  { key: "checkoutEntries", title: "チェックアウト" },
  { key: "roomServiceEntries", title: "ルームサービス" },
  { key: "transportEntries", title: "提携交通" },
  { key: "nearbySpotEntries", title: "周辺施設" },
];

async function authorizedFetch(input: RequestInfo, init?: RequestInit) {
  const currentUser = getFirebaseAuth().currentUser;

  if (!currentUser) {
    throw new Error("not-authenticated");
  }

  const token = await currentUser.getIdToken();

  return fetch(input, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

function isEntryRecord(entry: OperationsInfoEntry): entry is Record<string, unknown> {
  return typeof entry === "object" && entry !== null && !Array.isArray(entry);
}

function findFirstValue(entry: Record<string, unknown>, candidates: string[]) {
  for (const candidate of candidates) {
    const value = entry[candidate];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return undefined;
}

function formatLabelFromKey(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "未設定";
  }

  if (Array.isArray(value)) {
    const joined = value
      .map((item) => formatValue(item))
      .filter((item) => item !== "未設定")
      .join(" / ");

    return joined || "未設定";
  }

  if (typeof value === "boolean") {
    return value ? "あり" : "なし";
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length > 0
      ? entries.map(([key, nestedValue]) => `${formatLabelFromKey(key)}: ${formatValue(nestedValue)}`).join(" / ")
      : "未設定";
  }

  return String(value);
}

function buildEntryRows(sectionKey: OperationsInfoKey, entry: Record<string, unknown>) {
  const rows: Array<{ label: string; value: string }> = [];
  const consumedKeys = new Set<string>();

  const pushRow = (label: string, candidateKeys: string[]) => {
    const value = findFirstValue(entry, candidateKeys);
    if (value === undefined) {
      return;
    }

    rows.push({ label, value: formatValue(value) });
    candidateKeys.forEach((key) => consumedKeys.add(key));
  };

  if (sectionKey === "wifiNetworks") {
    pushRow("対象階", ["targetFloor", "targetFloors", "floor", "floors", "target_floor"]);
    pushRow("SSID", ["ssid", "networkName", "name"]);
    pushRow("パスワード", ["password", "passcode", "wifiPassword"]);
    pushRow("補足", ["note", "notes", "memo", "description", "remarks"]);
  } else if (sectionKey === "faqEntries") {
    pushRow("質問", ["question", "title", "q"]);
    pushRow("回答", ["answer", "body", "a"]);
  } else if (sectionKey === "emergencyEntries") {
    pushRow("カテゴリ", ["category", "type"]);
    pushRow("連絡先", ["contact", "contactInfo", "phone", "phoneNumber"]);
    pushRow("手順", ["procedure", "steps", "action", "instruction"]);
    pushRow("補足", ["note", "notes", "memo", "description", "remarks"]);
  } else if (sectionKey === "nearbySpotEntries") {
    pushRow("施設名", ["name", "spotName", "facilityName", "title"]);
    pushRow("カテゴリ", ["category", "type"]);
    pushRow("距離・所要時間", ["distanceAndDuration", "distance", "duration", "travelTime"]);
    pushRow("営業時間", ["businessHours", "hours", "openingHours"]);
    pushRow("場所", ["location", "address", "place"]);
    pushRow("補足", ["note", "notes", "memo", "description", "remarks"]);
  }

  for (const [key, value] of Object.entries(entry)) {
    if (consumedKeys.has(key)) {
      continue;
    }

    rows.push({
      label: formatLabelFromKey(key),
      value: formatValue(value),
    });
  }

  return rows;
}

function OperationsEntryCard({
  entry,
  index,
  sectionKey,
}: {
  entry: OperationsInfoEntry;
  index: number;
  sectionKey: OperationsInfoKey;
}) {
  if (!isEntryRecord(entry)) {
    return (
      <div className="rounded-[8px] border border-[#ecd2cf] bg-white px-4 py-3 text-sm text-stone-700">
        {formatValue(entry)}
      </div>
    );
  }

  const rows = buildEntryRows(sectionKey, entry);

  return (
    <div className="rounded-[8px] border border-[#ecd2cf] bg-white px-4 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Entry {index + 1}</p>
      {rows.length > 0 ? (
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={`${row.label}-${row.value}`} className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">{row.label}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-stone-900">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-stone-500">未設定</p>
      )}
    </div>
  );
}

function OperationsSection({
  entries,
  sectionKey,
  title,
}: {
  entries: OperationsInfoEntry[];
  sectionKey: OperationsInfoKey;
  title: string;
}) {
  return (
    <section className="rounded-[10px] border border-[#ecd2cf] bg-white px-4 py-4">
      <div className="border-b border-[#f0dfdc] pb-3">
        <h4 className="text-base font-semibold text-stone-950">{title}</h4>
      </div>
      <div className="mt-4 space-y-3">
        {entries.length > 0 ? (
          entries.map((entry, index) => (
            <OperationsEntryCard
              key={`${sectionKey}-${index}`}
              entry={entry}
              index={index}
              sectionKey={sectionKey}
            />
          ))
        ) : (
          <p className="rounded-[8px] border border-dashed border-[#ecd2cf] bg-[#fff8f7] px-4 py-3 text-sm text-stone-500">
            未設定
          </p>
        )}
      </div>
    </section>
  );
}

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
  const [operationsInfoState, setOperationsInfoState] = useState<OperationsInfoState>(initialOperationsInfoState);

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

  useEffect(() => {
    let isActive = true;

    async function loadOperationsInfo() {
      if (!user) {
        if (isActive) {
          setOperationsInfoState(initialOperationsInfoState);
        }
        return;
      }

      setOperationsInfoState((current) => ({
        ...current,
        error: null,
        isLoading: true,
      }));

      try {
        const response = await authorizedFetch("/api/frontdesk/operations-info");
        const payload = (await response.json()) as OperationsInfoResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "failed-to-load-operations-info");
        }

        if (!isActive) {
          return;
        }

        setOperationsInfoState({
          data: payload.operationsInfo ?? createEmptyOperationsInfo(),
          error: null,
          hotelId: payload.hotelId ?? "",
          isLoading: false,
        });
      } catch (error) {
        if (!isActive) {
          return;
        }

        setOperationsInfoState({
          data: createEmptyOperationsInfo(),
          error: error instanceof Error ? error.message : "failed-to-load-operations-info",
          hotelId: "",
          isLoading: false,
        });
      }
    }

    void loadOperationsInfo();

    return () => {
      isActive = false;
    };
  }, [user]);

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
        pageSubtitle="通知や表示設定と、ゲスト案内に必要な運用情報を確認できます"
        pageTitle="設定"
        onLogout={() => logout()}
      >
      <div className="px-4 py-5 sm:px-6 lg:px-8">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_340px]">
          <div className="space-y-5">
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

            <section className="overflow-hidden rounded-[10px] border border-[#ecd2cf] bg-[#fff8f7] shadow-[0_12px_30px_rgba(72,32,28,0.06)]">
              <div className="border-b border-[#ecd2cf] bg-white px-5 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ad2218]">Operations</p>
                <h3 className="mt-2 text-xl font-semibold text-stone-950">ホテル情報一覧</h3>
                <p className="mt-2 text-sm leading-6 text-stone-500">
                  変更等がある場合は運営会社にご連絡ください
                </p>
              </div>

              <div className="space-y-5 p-4 sm:p-5">
                {operationsInfoState.isLoading ? (
                  <p className="rounded-[8px] border border-[#ecd2cf] bg-white px-4 py-3 text-sm text-stone-500">
                    読み込み中
                  </p>
                ) : null}
                {operationsInfoState.error ? (
                  <p className="rounded-[8px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {operationsInfoState.error}
                  </p>
                ) : null}
                <div className="space-y-4">
                  {operationsSectionOrder.map((section) => (
                    <OperationsSection
                      key={section.key}
                      entries={operationsInfoState.data[section.key]}
                      sectionKey={section.key}
                      title={section.title}
                    />
                  ))}
                </div>
              </div>
            </section>
          </div>

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
