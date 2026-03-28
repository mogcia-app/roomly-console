"use client";

import { useDeferredValue, useMemo } from "react";
import { HotelAuthCard } from "@/components/auth/hotel-auth-card";
import { FrontdeskShell } from "@/components/frontdesk/frontdesk-shell";
import { formatInquiryType, formatIsoDateTime, formatRoomLabel, formatStatusLabel } from "@/lib/frontdesk/format";
import { buildInquiryHistory, useRecentCalls, useRecentThreads } from "@/hooks/useFrontdeskData";
import { useHotelAuth } from "@/hooks/useHotelAuth";

const defaultHotelId = process.env.NEXT_PUBLIC_DEFAULT_HOTEL_ID ?? "";

export function FrontdeskHistoryPage() {
  const { user, claims, isLoading: authLoading, error: authError, login, logout } = useHotelAuth();

  const hotelId = useDeferredValue((claims?.hotel_id ?? defaultHotelId).trim());
  const recentCalls = useRecentCalls(hotelId);
  const recentThreads = useRecentThreads(hotelId);
  const historyItems = useMemo(
    () => buildInquiryHistory(recentCalls.data, recentThreads.data),
    [recentCalls.data, recentThreads.data],
  );

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
      pageSubtitle="通話とチャットの履歴を統合して、あとから追えるようにします。"
      pageTitle="履歴"
      onLogout={() => logout()}
    >
      <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">問い合わせ履歴</h3>
            <p className="text-sm text-slate-500">通話失敗やチャット移行も同じ一覧で確認できます。</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {historyItems.length}件
          </span>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="grid grid-cols-[1.2fr_1fr_120px_120px_160px] gap-3 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <div>部屋 / 種別</div>
            <div>詳細</div>
            <div>状態</div>
            <div>担当</div>
            <div>更新時刻</div>
          </div>
          <div className="divide-y divide-slate-200">
            {historyItems.map((item) => (
              <div
                key={`${item.source}-${item.id}`}
                className="grid grid-cols-[1.2fr_1fr_120px_120px_160px] gap-3 px-4 py-4 text-sm"
              >
                <div>
                  <p className="font-medium text-slate-950">{formatRoomLabel(item.room_id, item.room_number)}</p>
                  <p className="mt-1 text-slate-500">{formatInquiryType(item.event_type, item.source)}</p>
                </div>
                <div className="text-slate-500">
                  <p>{item.guest_language ?? "言語未設定"}</p>
                  <p className="mt-1 truncate">{item.category ?? item.stay_id}</p>
                </div>
                <div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    {formatStatusLabel(item.status)}
                  </span>
                </div>
                <div className="truncate text-slate-500">{item.accepted_by ?? item.assigned_to ?? "-"}</div>
                <div className="text-slate-500">
                  {formatIsoDateTime(item.updated_at?.toDate().toISOString())}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </FrontdeskShell>
  );
}
