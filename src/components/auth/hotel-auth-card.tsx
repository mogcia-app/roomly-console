"use client";

import { useState } from "react";

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
    <section className="mx-auto grid min-h-screen w-full max-w-md place-items-center px-4 py-10">
      <form
        className="w-full rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-[0_24px_80px_rgba(43,51,43,0.12)] backdrop-blur"
        onSubmit={handleSubmit}
      >
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-teal-800">Roomly Hotel Console</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>

        <div className="mt-6 grid gap-4">
          <label className="grid gap-1 text-sm">
            <span className="text-stone-600">メールアドレス</span>
            <input
              className="rounded-2xl border border-stone-300 bg-white px-3 py-3 outline-none transition focus:border-teal-600"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="front@example.com"
              autoComplete="email"
              required
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-stone-600">パスワード</span>
            <input
              className="rounded-2xl border border-stone-300 bg-white px-3 py-3 outline-none transition focus:border-teal-600"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
        </div>

        {authError ? <p className="mt-4 text-sm text-rose-700">{authError}</p> : null}
        {submitError ? <p className="mt-4 text-sm text-rose-700">{submitError}</p> : null}

        <button
          type="submit"
          className="mt-6 w-full rounded-2xl bg-stone-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
          disabled={isLoading || isSubmitting}
        >
          {isSubmitting ? "ログイン中..." : "ログイン"}
        </button>
      </form>
    </section>
  );
}
