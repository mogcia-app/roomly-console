"use client";

import type { ReactNode } from "react";
import { FrontdeskSidebar } from "@/components/frontdesk/frontdesk-sidebar";

type FrontdeskShellProps = {
  children: ReactNode;
  pageSubtitle: string;
  pageTitle: string;
  onLogout: () => void;
  variant?: "default" | "messenger";
};

export function FrontdeskShell({
  children,
  pageSubtitle,
  pageTitle,
  onLogout,
  variant = "default",
}: FrontdeskShellProps) {
  return (
    <div className="min-h-dvh bg-[#f3f2ef] text-stone-900 lg:grid lg:grid-cols-[76px_minmax(0,1fr)]">
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur lg:static lg:border-r lg:border-t-0 lg:bg-white">
        <FrontdeskSidebar onLogout={onLogout} />
      </div>

      <main className="min-w-0 pb-22 lg:pb-0">
        <header
          className={`sticky top-0 z-20 border-b border-stone-200 bg-white/95 backdrop-blur ${
            variant === "messenger" ? "px-4 py-3 sm:px-6" : "px-4 py-4 sm:px-6"
          }`}
        >
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className={`${variant === "messenger" ? "text-lg" : "text-2xl"} font-semibold tracking-tight text-stone-950`}>
                {pageTitle}
              </h2>
              <p className={`${variant === "messenger" ? "mt-0.5 text-xs" : "mt-1 text-sm"} text-stone-500`}>
                {pageSubtitle}
              </p>
            </div>
          </div>
        </header>
        <div className="px-0 py-0">{children}</div>
      </main>
    </div>
  );
}
