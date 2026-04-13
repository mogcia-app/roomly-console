"use client";

import type { ReactNode } from "react";
import { RoomlyWordmark } from "@/components/brand/roomly-wordmark";
import { FrontdeskSidebar } from "@/components/frontdesk/frontdesk-sidebar";

type FrontdeskShellProps = {
  children: ReactNode;
  compactMode?: boolean;
  fixedHeader?: boolean;
  pageSubtitle: string;
  pageTitle: string;
  onLogout: () => void;
  role?: string;
  variant?: "default" | "messenger";
};

export function FrontdeskShell({
  children,
  compactMode = false,
  fixedHeader = false,
  pageSubtitle,
  pageTitle,
  onLogout,
  role,
  variant = "default",
}: FrontdeskShellProps) {
  const isMessenger = variant === "messenger";
  const useFixedLayout = isMessenger || fixedHeader;

  return (
    <div
      data-compact={compactMode ? "true" : "false"}
      className={`min-h-dvh text-stone-900 lg:grid lg:grid-cols-[188px_minmax(0,1fr)] ${
        useFixedLayout
          ? isMessenger
            ? "h-dvh overflow-hidden bg-[#f5efe8]"
            : "h-dvh overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.94),_rgba(245,239,232,0.95)_40%,_rgba(238,226,216,0.98)_100%)]"
          : "bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.94),_rgba(245,239,232,0.95)_40%,_rgba(238,226,216,0.98)_100%)]"
      }`}
    >
      <div
        className={`fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur lg:static lg:border-r lg:border-t-0 ${
          variant === "messenger"
            ? "border-[#e7d5d1] bg-white/96 lg:bg-[#fffaf9]"
            : "border-stone-200 bg-white/95 lg:bg-white/88 lg:backdrop-blur-xl"
        }`}
      >
        <FrontdeskSidebar onLogout={onLogout} role={role} />
      </div>

      <main className={`min-w-0 pb-24 lg:pb-0 ${useFixedLayout ? "flex h-dvh flex-col overflow-hidden" : ""}`}>
        <header
          className={`sticky top-0 z-20 backdrop-blur-xl ${
            isMessenger
              ? `border-b border-[#d9b1ac] bg-[#ad2218] text-white sm:px-6 lg:px-8 ${compactMode ? "px-4 py-2.5" : "px-4 py-3"}`
              : `border-b border-stone-200 bg-white/85 sm:px-6 lg:px-8 ${compactMode ? "px-4 py-3" : "px-4 py-4"}`
          }`}
        >
          <div className="flex items-end justify-between gap-4">
            <div>
              <p
                className={`text-[11px] font-semibold uppercase tracking-[0.24em] ${
                  isMessenger ? "text-white/72" : "text-[#ad2218]"
                }`}
              >
                {isMessenger ? "Chat Desk" : "Front Desk"}
              </p>
              <h2
                className={`${isMessenger ? `mt-1 text-white ${compactMode ? "text-lg lg:text-[1.65rem]" : "text-xl lg:text-2xl"}` : `mt-1 text-stone-950 ${compactMode ? "text-[1.65rem]" : "text-2xl"}`} font-semibold tracking-tight`}
              >
                <span className="inline-flex items-baseline gap-2">
                  <RoomlyWordmark dotClassName={isMessenger ? "text-[#ffd8d3]" : "text-[#ad2218]"} />
                  <span>{pageTitle}</span>
                </span>
              </h2>
              <p
                className={`${isMessenger ? "mt-1 text-xs sm:text-sm text-white/80" : "mt-1 text-sm text-stone-500"} max-w-2xl`}
              >
                {pageSubtitle}
              </p>
            </div>
          </div>
        </header>
        <div className={`px-0 py-0 ${useFixedLayout ? "min-h-0 flex-1 overflow-auto" : ""}`}>{children}</div>
      </main>
    </div>
  );
}
