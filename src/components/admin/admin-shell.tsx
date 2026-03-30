"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type AdminShellProps = {
  children: ReactNode;
};

const navItems = [
  { href: "/admin", label: "管理トップ" },
  { href: "/admin/rooms", label: "客室表示名" },
];

export function AdminShell({ children }: AdminShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(173,34,24,0.08),_transparent_28%),linear-gradient(180deg,_#fbf5f4_0%,_#f4ebe9_100%)] text-stone-900 lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="border-b border-[#ecd2cf] bg-white/92 lg:min-h-screen lg:border-b-0 lg:border-r">
        <div className="px-5 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#ad2218]">Roomly Admin</p>
          <h2 className="mt-2 text-lg font-semibold text-stone-950">ホテル管理画面</h2>
        </div>
        <nav className="grid gap-2 px-4 pb-4">
          {navItems.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-[8px] px-4 py-3 text-sm font-semibold transition ${
                  isActive ? "bg-[#ad2218] text-white" : "border border-[#ecd2cf] bg-white text-stone-700 hover:bg-[#fff8f7]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main>{children}</main>
    </div>
  );
}
