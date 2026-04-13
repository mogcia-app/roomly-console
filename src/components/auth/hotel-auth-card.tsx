"use client";

import Image from "next/image";
import { useState } from "react";
import { RoomlyWordmark } from "@/components/brand/roomly-wordmark";

type HotelAuthCardProps = {
  authError: string | null;
  description: string;
  isLoading: boolean;
  title: string;
  onSubmit: (email: string, password: string) => Promise<void>;
};

const defaultEmail = process.env.NEXT_PUBLIC_DEFAULT_FRONT_EMAIL ?? "";

export function HotelAuthCard({
  authError,
  description,
  isLoading,
  onSubmit,
  title,
}: HotelAuthCardProps) {
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      await onSubmit(email, password);
      setPassword("");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "login-failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="min-h-dvh bg-[#f5efe8] px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
      <div className="relative mx-auto flex min-h-[calc(100dvh-3rem)] max-w-6xl items-center">
        <div className="grid w-full gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)] lg:gap-6">
          <div className="rounded-[10px] bg-[linear-gradient(155deg,#fbf7f3_0%,#f3e8db_52%,#ebdacd_100%)] p-6 text-stone-950 shadow-[0_30px_90px_rgba(79,34,24,0.12)] sm:p-8 lg:min-h-[680px] lg:p-10">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-[10px] bg-white p-2">
                  <Image src="/favicon.ico" alt="Roomly icon" width={32} height={32} priority />
                </div>
                <span className="rounded-[10px] border border-[#ebd2cd] bg-white/72 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ad2218]">
                  Front Desk
                </span>
              </div>

              <div className="mt-8 lg:mt-12">
                <RoomlyWordmark className="text-[2rem] font-semibold tracking-tight text-stone-950 sm:text-[2.4rem]" dotClassName="text-[#ad2218]" />
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.28em] text-[#ad2218]">Front Desk Console</p>
                <h1 className="mt-3 text-[2rem] font-semibold tracking-tight text-stone-950 sm:text-[2.4rem] lg:text-[3.2rem]">
                  ホテル業務を
                  <br />
                  ひとつの画面で
                </h1>
                <p className="mt-4 max-w-md text-sm leading-7 text-stone-600 sm:text-base">
                  ゲスト対応から日々のオペレーションまで、必要な情報とアクションを
                  ひとつの画面に集約したフロントデスク向けコンソールです
                </p>
              </div>
            </div>
          </div>

          <form
            className="rounded-[10px] border border-[#ead9d1] bg-white/92 p-5 shadow-[0_26px_90px_rgba(53,39,32,0.12)] backdrop-blur-xl sm:p-7 lg:flex lg:min-h-[680px] lg:flex-col lg:justify-center lg:p-10"
            onSubmit={handleSubmit}
          >
            <div className="lg:max-w-xl">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#ad2218]">Secure Sign In</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-stone-950 sm:text-[2.2rem]">{title}</h2>
              </div>

              <p className="mt-4 max-w-lg text-sm leading-7 text-stone-600 sm:text-[15px]">{description}</p>

              <div className="mt-6 rounded-[10px] bg-[#f5efe8] p-4 sm:p-5">
                <div className="grid gap-4">
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium text-stone-700">メールアドレス</span>
                    <input
                      className="rounded-[10px] border border-[#ddc8be] bg-white px-4 py-3.5 text-stone-950 outline-none transition focus:border-[#ad2218]"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="front@example.com"
                      autoComplete="email"
                      required
                    />
                  </label>

                  <label className="grid gap-2 text-sm">
                    <span className="font-medium text-stone-700">パスワード</span>
                    <div className="flex items-center gap-2">
                      <input
                        className="min-w-0 flex-1 rounded-[10px] border border-[#ddc8be] bg-white px-4 py-3.5 text-stone-950 outline-none transition focus:border-[#ad2218]"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete="current-password"
                        required
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded-[10px] border border-[#ddc8be] bg-white px-4 py-3.5 text-xs font-semibold text-stone-600 transition hover:border-[#ad2218] hover:text-[#ad2218]"
                        onClick={() => setShowPassword((current) => !current)}
                      >
                        {showPassword ? "非表示" : "表示"}
                      </button>
                    </div>
                  </label>
                </div>
              </div>

              {authError ? (
                <p className="mt-4 rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{authError}</p>
              ) : null}
              {submitError ? (
                <p className="mt-4 rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{submitError}</p>
              ) : null}
            </div>

            <div className="mt-5 lg:mt-6 lg:max-w-xl">
              <button
                type="submit"
                className="w-full rounded-[10px] bg-[#ad2218] px-4 py-4 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-stone-300"
                disabled={isLoading || isSubmitting}
              >
                {isSubmitting ? "ログイン中..." : "ログイン"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
