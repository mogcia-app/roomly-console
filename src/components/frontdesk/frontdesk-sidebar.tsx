"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type FrontdeskSidebarProps = {
  onLogout: () => void;
};

const navItems = [
  { href: "/", label: "受信" },
  { href: "/requests", label: "依頼" },
  { href: "/history", label: "履歴" },
  { href: "/settings", label: "設定" },
];

export function FrontdeskSidebar({
  onLogout,
}: FrontdeskSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full flex-col items-center overflow-hidden bg-white py-4">
      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#ad2218] text-sm font-semibold text-white shadow-sm">
        室
      </div>

      <div className="mt-6">
        <nav className="space-y-3">
          {navItems.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.label}
                href={item.href}
                aria-label={item.label}
                title={item.label}
                className={`flex h-11 w-12 items-center justify-center rounded-2xl text-xs font-semibold transition ${
                  isActive ? "bg-[#fff1ef] shadow-sm ring-1 ring-[#f0c6c2]" : "hover:bg-stone-100"
                }`}
              >
                <span className={isActive ? "text-[#ad2218]" : "text-stone-600"}>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto">
        <button
          type="button"
          aria-label="ログアウト"
          title="ログアウト"
          className="flex h-11 w-11 items-center justify-center rounded-2xl text-stone-500 transition hover:bg-stone-100"
          onClick={onLogout}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none" stroke="currentColor" strokeWidth="1.8">
            <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
            <path d="M16 17l5-5-5-5M21 12H10" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
