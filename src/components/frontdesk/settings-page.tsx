"use client";

import { useEffect, useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { HotelAuthCard } from "@/components/auth/hotel-auth-card";
import { FrontdeskAuthLoading } from "@/components/frontdesk/frontdesk-auth-loading";
import { FrontdeskShell } from "@/components/frontdesk/frontdesk-shell";
import { useHotelAuth } from "@/hooks/useHotelAuth";
import { useCompactModePreference } from "@/hooks/useFrontdeskPreferences";
import { useHotelReplyTemplates } from "@/hooks/useHotelReplyTemplates";
import { getFirebaseAuth } from "@/lib/firebase";
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
            <div key={`${sectionKey}-${index}`} className="rounded-[8px] border border-[#ecd2cf] bg-white px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Entry {index + 1}</p>

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
            </div>
          ))
        ) : (
          <div className="rounded-[8px] border border-dashed border-[#ecd2cf] bg-[#fff8f7] px-4 py-4">
            <p className="text-sm text-stone-500">未設定</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function FrontdeskSettingsPage() {
  const { user, claims, isLoading: authLoading, error: authError, login, logout } = useHotelAuth();
  const [compactMode] = useCompactModePreference();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordActionMessage, setPasswordActionMessage] = useState<string | null>(null);
  const [passwordActionError, setPasswordActionError] = useState<string | null>(null);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [operationsInfoState, setOperationsInfoState] = useState<OperationsInfoState>(initialOperationsInfoState);
  const replyTemplatesState = useHotelReplyTemplates(Boolean(user));
  const [replyTemplatesActionMessage, setReplyTemplatesActionMessage] = useState<string | null>(null);
  const [replyTemplatesActionError, setReplyTemplatesActionError] = useState<string | null>(null);
  const [isSavingReplyTemplates, setIsSavingReplyTemplates] = useState(false);

  const role = claims?.role;

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

  async function handleUpdatePassword() {
    const authUser = getFirebaseAuth().currentUser;

    if (!authUser?.email) {
      setPasswordActionError("アカウント情報を確認できません");
      setPasswordActionMessage(null);
      return;
    }

    if (!currentPassword.trim()) {
      setPasswordActionError("現在のパスワードを入力してください");
      setPasswordActionMessage(null);
      return;
    }

    if (!newPassword.trim()) {
      setPasswordActionError("新しいパスワードを入力してください");
      setPasswordActionMessage(null);
      return;
    }

    if (newPassword.length < 6) {
      setPasswordActionError("新しいパスワードは6文字以上で入力してください");
      setPasswordActionMessage(null);
      return;
    }

    setIsUpdatingPassword(true);
    setPasswordActionError(null);
    setPasswordActionMessage(null);

    try {
      const credential = EmailAuthProvider.credential(authUser.email, currentPassword);
      await reauthenticateWithCredential(authUser, credential);
      await updatePassword(authUser, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordActionMessage("パスワードを更新しました");
    } catch (error) {
      const message = error instanceof Error ? error.message : "password-update-failed";

      if (message.includes("auth/invalid-credential")) {
        setPasswordActionError("現在のパスワードが正しくありません");
      } else if (message.includes("auth/weak-password")) {
        setPasswordActionError("新しいパスワードが弱すぎます");
      } else {
        setPasswordActionError(message);
      }
    } finally {
      setIsUpdatingPassword(false);
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
            <section
              id="reply-templates"
              className="overflow-hidden rounded-[10px] border border-[#ecd2cf] bg-[#fff8f7] shadow-[0_12px_30px_rgba(72,32,28,0.06)]"
            >
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
                  ホテル情報と案内内容を一覧で確認できます
                </p>
              </div>

              <div className={`space-y-5 ${compactMode ? "p-4" : "p-4 sm:p-5"}`}>
                <div className="rounded-[8px] border border-[#ecd2cf] bg-white px-4 py-3">
                  <p className="text-sm font-medium text-stone-900">閲覧専用</p>
                  <p className="mt-1 text-xs leading-5 text-stone-500">
                    この画面ではホテル情報の確認のみ行えます
                  </p>
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

          <div className={compactMode ? "space-y-4" : "space-y-5"}>
            <section className="overflow-hidden rounded-[10px] border border-[#ecd2cf] bg-[#fff8f7] shadow-[0_12px_30px_rgba(72,32,28,0.06)]">
              <div className="border-b border-[#ecd2cf] bg-white px-5 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ad2218]">Security</p>
                <h3 className="mt-2 text-xl font-semibold text-stone-950">パスワード変更</h3>
                <p className="mt-2 text-sm leading-6 text-stone-500">
                  現在のパスワードを確認したうえで、新しいパスワードへ更新します
                </p>
              </div>

              <div className="space-y-4 p-4 sm:p-5">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-stone-700">現在のパスワード</span>
                  <input
                    type="password"
                    className="rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] px-3 py-3 outline-none transition focus:border-[#ad2218]"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    autoComplete="current-password"
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-stone-700">新しいパスワード</span>
                  <input
                    type="password"
                    className="rounded-[8px] border border-[#ecd2cf] bg-[#fff8f7] px-3 py-3 outline-none transition focus:border-[#ad2218]"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <button
                  type="button"
                  className="w-full rounded-[8px] bg-[#ad2218] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-stone-300"
                  onClick={() => void handleUpdatePassword()}
                  disabled={isUpdatingPassword || !user.email}
                >
                  {isUpdatingPassword ? "保存中" : "保存"}
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

            <section className="rounded-[10px] border border-[#ecd2cf] bg-[#fff8f7] p-4 shadow-[0_12px_30px_rgba(72,32,28,0.06)] sm:p-5">
                <button
                  type="button"
                  className="w-full rounded-[8px] border border-[#ecd2cf] bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-[#fff8f7]"
                  onClick={() => void logout()}
                >
                  ログアウト
                </button>
            </section>
          </div>
        </div>
      </div>
    </FrontdeskShell>
  );
}
