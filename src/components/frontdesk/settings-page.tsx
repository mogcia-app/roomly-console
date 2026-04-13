"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { HotelAuthCard } from "@/components/auth/hotel-auth-card";
import { FrontdeskAuthLoading } from "@/components/frontdesk/frontdesk-auth-loading";
import { FrontdeskShell } from "@/components/frontdesk/frontdesk-shell";
import { useHotelAuth } from "@/hooks/useHotelAuth";
import { useCompactModePreference } from "@/hooks/useFrontdeskPreferences";
import { useHotelReplyTemplates } from "@/hooks/useHotelReplyTemplates";
import { getFirebaseAuth } from "@/lib/firebase";
import { FRONTDESK_NOTIFICATION_ENABLED_KEY } from "@/lib/frontdesk/preferences";
import { createEmptyOperationsInfo, type OperationsInfoEntry, type OperationsInfoKey, type OperationsInfoRecord } from "@/lib/frontdesk/operations-info";
import type { FrontdeskReplyTemplate } from "@/lib/frontdesk/reply-templates";

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

type OperationsInfoDraftState = Record<OperationsInfoKey, string[]>;

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

function entryToEditorText(entry: OperationsInfoEntry) {
  if (typeof entry === "string") {
    return entry;
  }

  return JSON.stringify(entry, null, 2);
}

function createDraftState(data: OperationsInfoRecord): OperationsInfoDraftState {
  return Object.fromEntries(
    operationsSectionOrder.map((section) => [section.key, data[section.key].map((entry) => entryToEditorText(entry))]),
  ) as OperationsInfoDraftState;
}

function parseDraftEntry(value: string): OperationsInfoEntry {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("empty-entry");
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed === "true" || trimmed === "false" || /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return JSON.parse(trimmed) as OperationsInfoEntry;
  }

  return trimmed;
}

function buildOperationsInfoFromDraft(draft: OperationsInfoDraftState): OperationsInfoRecord {
  const next = createEmptyOperationsInfo();

  for (const section of operationsSectionOrder) {
    next[section.key] = draft[section.key]
      .map((entry) => parseDraftEntry(entry))
      .filter((entry) => entry !== null && entry !== undefined && entry !== "");
  }

  return next;
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

function OperationsSection({
  draftEntries,
  entries,
  onAdd,
  onChangeEntry,
  onDeleteEntry,
  sectionKey,
  title,
}: {
  draftEntries: string[];
  entries: OperationsInfoEntry[];
  onAdd: () => void;
  onChangeEntry: (index: number, value: string) => void;
  onDeleteEntry: (index: number) => void;
  sectionKey: OperationsInfoKey;
  title: string;
}) {
  return (
    <section className="rounded-[10px] border border-[#ecd2cf] bg-white px-4 py-4">
      <div className="flex items-center justify-between gap-3 border-b border-[#f0dfdc] pb-3">
        <h4 className="text-base font-semibold text-stone-950">{title}</h4>
        <button
          type="button"
          className="rounded-[8px] border border-[#ecd2cf] px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-[#fff8f7]"
          onClick={onAdd}
        >
          項目を追加
        </button>
      </div>
      <div className="mt-4 space-y-3">
        {entries.length > 0 ? (
          entries.map((entry, index) => (
            <div key={`${sectionKey}-${index}`} className="rounded-[8px] border border-[#ecd2cf] bg-white px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Entry {index + 1}</p>
                <button
                  type="button"
                  className="rounded-[8px] border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
                  onClick={() => onDeleteEntry(index)}
                >
                  削除
                </button>
              </div>

              {isEntryRecord(entry) ? (
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  {buildEntryRows(sectionKey, entry).map((row) => (
                    <div key={`${row.label}-${row.value}`} className="min-w-0">
                      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">{row.label}</dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-stone-900">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-stone-700">{formatValue(entry)}</p>
              )}

              <label className="mt-4 grid gap-2 text-sm">
                <span className="font-medium text-stone-700">編集内容</span>
                <textarea
                  rows={isEntryRecord(entry) ? 8 : 4}
                  className="w-full rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] px-3 py-3 font-mono text-sm leading-6 text-stone-900 outline-none transition focus:border-[#ad2218]"
                  value={draftEntries[index] ?? ""}
                  onChange={(event) => onChangeEntry(index, event.target.value)}
                />
              </label>
              <p className="mt-2 text-xs leading-5 text-stone-500">
                文字列はそのまま入力、構造化データは JSON で編集できます
              </p>
            </div>
          ))
        ) : (
          <div className="rounded-[8px] border border-dashed border-[#ecd2cf] bg-[#fff8f7] px-4 py-4">
            <p className="text-sm text-stone-500">未設定</p>
            <p className="mt-1 text-xs text-stone-400">追加して保存するとホテル側で更新できます</p>
          </div>
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
  const [compactMode, setCompactMode] = useCompactModePreference();
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [passwordActionMessage, setPasswordActionMessage] = useState<string | null>(null);
  const [passwordActionError, setPasswordActionError] = useState<string | null>(null);
  const [isSendingPasswordReset, setIsSendingPasswordReset] = useState(false);
  const [operationsInfoState, setOperationsInfoState] = useState<OperationsInfoState>(initialOperationsInfoState);
  const [operationsDraft, setOperationsDraft] = useState<OperationsInfoDraftState>(() =>
    createDraftState(createEmptyOperationsInfo()),
  );
  const [operationsActionMessage, setOperationsActionMessage] = useState<string | null>(null);
  const [operationsActionError, setOperationsActionError] = useState<string | null>(null);
  const [isSavingOperationsInfo, setIsSavingOperationsInfo] = useState(false);
  const replyTemplatesState = useHotelReplyTemplates(Boolean(user));
  const [replyTemplatesActionMessage, setReplyTemplatesActionMessage] = useState<string | null>(null);
  const [replyTemplatesActionError, setReplyTemplatesActionError] = useState<string | null>(null);
  const [isSavingReplyTemplates, setIsSavingReplyTemplates] = useState(false);

  const role = claims?.role;
  const staffUserId = useDeferredValue(user?.uid ?? "");

  function updateReplyTemplate(templateId: string, patch: Partial<FrontdeskReplyTemplate>) {
    replyTemplatesState.setTemplates((current) =>
      current.map((template) => (template.id === templateId ? { ...template, ...patch } : template)),
    );
  }

  function addReplyTemplate() {
    const nextIndex = replyTemplatesState.templates.length + 1;
    replyTemplatesState.setTemplates((current) => [
      ...current,
      {
        id: `custom-${Date.now()}`,
        label: `テンプレ ${nextIndex}`,
        body: "",
      },
    ]);
  }

  function deleteReplyTemplate(templateId: string) {
    replyTemplatesState.setTemplates((current) => current.filter((template) => template.id !== templateId));
  }

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
        setOperationsDraft(createDraftState(payload.operationsInfo ?? createEmptyOperationsInfo()));
        setOperationsActionError(null);
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
        setOperationsDraft(createDraftState(createEmptyOperationsInfo()));
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

  function updateDraftEntry(sectionKey: OperationsInfoKey, index: number, value: string) {
    setOperationsDraft((current) => ({
      ...current,
      [sectionKey]: current[sectionKey].map((entry, entryIndex) => (entryIndex === index ? value : entry)),
    }));
  }

  function addDraftEntry(sectionKey: OperationsInfoKey) {
    setOperationsDraft((current) => ({
      ...current,
      [sectionKey]: [...current[sectionKey], ""],
    }));
    setOperationsInfoState((current) => ({
      ...current,
      data: {
        ...current.data,
        [sectionKey]: [...current.data[sectionKey], ""],
      },
    }));
  }

  function deleteDraftEntry(sectionKey: OperationsInfoKey, index: number) {
    setOperationsDraft((current) => ({
      ...current,
      [sectionKey]: current[sectionKey].filter((_, entryIndex) => entryIndex !== index),
    }));
    setOperationsInfoState((current) => ({
      ...current,
      data: {
        ...current.data,
        [sectionKey]: current.data[sectionKey].filter((_, entryIndex) => entryIndex !== index),
      },
    }));
  }

  async function handleSaveOperationsInfo() {
    setOperationsActionMessage(null);
    setOperationsActionError(null);

    let nextOperationsInfo: OperationsInfoRecord;
    try {
      nextOperationsInfo = buildOperationsInfoFromDraft(operationsDraft);
    } catch (error) {
      setOperationsActionError(
        error instanceof Error && error.message === "empty-entry"
          ? "空の項目は削除するか内容を入力してください"
          : "JSON形式が正しくありません",
      );
      return;
    }

    setIsSavingOperationsInfo(true);

    try {
      const response = await authorizedFetch("/api/frontdesk/operations-info", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operationsInfo: nextOperationsInfo,
        }),
      });
      const payload = (await response.json()) as OperationsInfoResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "failed-to-save-operations-info");
      }

      const savedData = payload.operationsInfo ?? nextOperationsInfo;
      setOperationsInfoState((current) => ({
        ...current,
        data: savedData,
        error: null,
        hotelId: payload.hotelId ?? current.hotelId,
      }));
      setOperationsDraft(createDraftState(savedData));
      setOperationsActionMessage("ホテル情報を更新しました");
    } catch (error) {
      setOperationsActionError(error instanceof Error ? error.message : "failed-to-save-operations-info");
    } finally {
      setIsSavingOperationsInfo(false);
    }
  }

  async function handleSaveReplyTemplates() {
    setReplyTemplatesActionMessage(null);
    setReplyTemplatesActionError(null);
    setIsSavingReplyTemplates(true);

    try {
      const savedTemplates = await replyTemplatesState.save(replyTemplatesState.templates);
      replyTemplatesState.setTemplates(savedTemplates);
      setReplyTemplatesActionMessage("返信テンプレートを保存しました");
    } catch (error) {
      setReplyTemplatesActionError(error instanceof Error ? error.message : "failed-to-save-reply-templates");
    } finally {
      setIsSavingReplyTemplates(false);
    }
  }

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

  return (
      <FrontdeskShell
        compactMode={compactMode}
        fixedHeader
        pageSubtitle="通知や表示設定と、ゲスト案内に必要な運用情報を確認できます"
        pageTitle="設定"
        onLogout={() => logout()}
        role={role}
      >
      <div className={`px-4 sm:px-6 lg:px-8 ${compactMode ? "py-4" : "py-5"}`}>
        <div className={`grid lg:grid-cols-[minmax(0,1.2fr)_340px] ${compactMode ? "gap-4" : "gap-5"}`}>
          <div className={compactMode ? "space-y-4" : "space-y-5"}>
            <section className="overflow-hidden rounded-[10px] border border-[#ecd2cf] bg-[#fff8f7] shadow-[0_12px_30px_rgba(72,32,28,0.06)]">
              <div className="border-b border-[#ecd2cf] bg-white px-5 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ad2218]">Display</p>
                <h3 className="mt-2 text-xl font-semibold text-stone-950">画面設定</h3>
                <p className="mt-2 text-sm leading-6 text-stone-500">
                  通知や表示スタイルをここで切り替えられます
                </p>
              </div>

              <div className={`space-y-4 ${compactMode ? "p-4" : "p-4 sm:p-5"}`}>
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
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ad2218]">Templates</p>
                    <h3 className="mt-2 text-xl font-semibold text-stone-950">返信テンプレート</h3>
                    <p className="mt-2 text-sm leading-6 text-stone-500">
                      チャット画面で使う定型文を自分で追加・編集・削除できます
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-[8px] bg-[#ad2218] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95"
                    onClick={addReplyTemplate}
                  >
                    テンプレ追加
                  </button>
                </div>
              </div>

              <div className={`space-y-4 ${compactMode ? "p-4" : "p-4 sm:p-5"}`}>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#ecd2cf] bg-white px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-stone-900">ホテル共通テンプレート</p>
                    <p className="mt-1 text-xs leading-5 text-stone-500">
                      保存すると同じホテルのスタッフ全員に反映されます
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-[8px] bg-[#ad2218] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-stone-300"
                    onClick={() => void handleSaveReplyTemplates()}
                    disabled={replyTemplatesState.isLoading || isSavingReplyTemplates}
                  >
                    {isSavingReplyTemplates ? "保存中" : "テンプレを保存"}
                  </button>
                </div>
                {replyTemplatesState.error ? (
                  <p className="rounded-[8px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {replyTemplatesState.error}
                  </p>
                ) : null}
                {replyTemplatesActionMessage ? (
                  <p className="rounded-[8px] border border-[#e7c0bb] bg-[#fff1ef] px-4 py-3 text-sm text-[#ad2218]">
                    {replyTemplatesActionMessage}
                  </p>
                ) : null}
                {replyTemplatesActionError ? (
                  <p className="rounded-[8px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {replyTemplatesActionError}
                  </p>
                ) : null}
                {replyTemplatesState.isLoading ? (
                  <p className="rounded-[8px] border border-[#ecd2cf] bg-white px-4 py-3 text-sm text-stone-500">
                    読み込み中
                  </p>
                ) : null}
                {replyTemplatesState.templates.map((template) => (
                  <article key={template.id} className="rounded-[8px] border border-[#ecd2cf] bg-white px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-stone-950">{template.label || "未設定テンプレ"}</p>
                      <button
                        type="button"
                        className="rounded-[8px] border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
                        onClick={() => deleteReplyTemplate(template.id)}
                      >
                        削除
                      </button>
                    </div>

                    <div className="mt-4 grid gap-3">
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium text-stone-700">ラベル</span>
                        <input
                          className="rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] px-3 py-3 outline-none transition focus:border-[#ad2218]"
                          value={template.label}
                          onChange={(event) => updateReplyTemplate(template.id, { label: event.target.value })}
                          placeholder="タオル"
                        />
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium text-stone-700">本文</span>
                        <textarea
                          rows={4}
                          className="rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] px-3 py-3 text-sm leading-6 outline-none transition focus:border-[#ad2218]"
                          value={template.body}
                          onChange={(event) => updateReplyTemplate(template.id, { body: event.target.value })}
                          placeholder="タオルをお持ちします。少々お待ちください。"
                        />
                      </label>
                    </div>
                  </article>
                ))}

                {!replyTemplatesState.isLoading && replyTemplatesState.templates.length === 0 ? (
                  <p className="rounded-[8px] border border-dashed border-[#ecd2cf] bg-white px-4 py-5 text-sm text-stone-500">
                    テンプレートはまだありません
                  </p>
                ) : null}
              </div>
            </section>

            <section className="overflow-hidden rounded-[10px] border border-[#ecd2cf] bg-[#fff8f7] shadow-[0_12px_30px_rgba(72,32,28,0.06)]">
              <div className="border-b border-[#ecd2cf] bg-white px-5 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ad2218]">Operations</p>
                <h3 className="mt-2 text-xl font-semibold text-stone-950">ホテル情報一覧</h3>
                <p className="mt-2 text-sm leading-6 text-stone-500">
                  ホテル側で内容の修正・追加・削除を行えます
                </p>
              </div>

              <div className={`space-y-5 ${compactMode ? "p-4" : "p-4 sm:p-5"}`}>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#ecd2cf] bg-white px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-stone-900">ホテル情報を編集</p>
                    <p className="mt-1 text-xs leading-5 text-stone-500">
                      JSON項目もそのまま編集できます。不要な項目は削除してください。
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-[8px] bg-[#ad2218] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-stone-300"
                    onClick={() => void handleSaveOperationsInfo()}
                    disabled={operationsInfoState.isLoading || isSavingOperationsInfo}
                  >
                    {isSavingOperationsInfo ? "保存中" : "変更を保存"}
                  </button>
                </div>
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
                {operationsActionMessage ? (
                  <p className="rounded-[8px] border border-[#e7c0bb] bg-[#fff1ef] px-4 py-3 text-sm text-[#ad2218]">
                    {operationsActionMessage}
                  </p>
                ) : null}
                {operationsActionError ? (
                  <p className="rounded-[8px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {operationsActionError}
                  </p>
                ) : null}
                <div className="space-y-4">
                  {operationsSectionOrder.map((section) => (
                    <OperationsSection
                      draftEntries={operationsDraft[section.key]}
                      key={section.key}
                      entries={operationsInfoState.data[section.key]}
                      onAdd={() => addDraftEntry(section.key)}
                      onChangeEntry={(index, value) => updateDraftEntry(section.key, index, value)}
                      onDeleteEntry={(index) => deleteDraftEntry(section.key, index)}
                      sectionKey={section.key}
                      title={section.title}
                    />
                  ))}
                </div>
              </div>
            </section>
          </div>

          <div className={compactMode ? "space-y-4" : "space-y-5"}>
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
