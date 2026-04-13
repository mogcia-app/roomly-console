"use client";

import { RoomlyWordmark } from "@/components/brand/roomly-wordmark";

export function FrontdeskAuthLoading({ title }: { title: string }) {
  return (
    <section className="min-h-dvh bg-[#f5efe8] px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-6xl items-center justify-center">
        <div className="w-full max-w-xl rounded-[32px] border border-[#ead9d1] bg-white/92 px-6 py-8 text-center shadow-[0_26px_90px_rgba(53,39,32,0.12)] backdrop-blur-xl sm:px-8">
          <div className="mb-4">
            <RoomlyWordmark className="text-2xl font-semibold tracking-tight text-stone-950" dotClassName="text-[#ad2218]" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#ad2218]">Secure Sign In</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-stone-950">{title}</h1>
          <p className="mt-3 text-sm text-stone-500">ログイン状態を確認しています</p>
        </div>
      </div>
    </section>
  );
}
