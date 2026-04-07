"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type FrontdeskSidebarProps = {
  onLogout: () => void;
  role?: string;
};

const baseNavItems = [
  {
    href: "/",
    label: "チャット",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7 18.5h7l4 3V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v10.5a2 2 0 0 0 2 2Z" />
        <path d="M8.5 9.5h7M8.5 13h5" />
      </svg>
    ),
  },
  {
    href: "/rooms",
    label: "滞在管理",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 20h16" />
        <path d="M6 20V7l6-3 6 3v13" />
        <path d="M9 11h6" />
        <path d="M9 15h6" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "設定",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Z" />
        <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 1 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a2 2 0 1 1 4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2a2 2 0 1 1 0 4h-.2a1 1 0 0 0-.9.6Z" />
      </svg>
    ),
  },
];

export function FrontdeskSidebar({
  onLogout,
}: FrontdeskSidebarProps) {
  const pathname = usePathname();
  const navItems = baseNavItems;

  return (
    <aside className="flex items-center justify-between gap-3 px-3 py-2.5 lg:h-full lg:flex-col lg:justify-start lg:px-4 lg:py-5">
      <div className="hidden lg:block lg:w-full">
        <div className="rounded-[18px] border border-stone-200 bg-white px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-400">Roomly</p>
          <h2 className="mt-2 text-base font-semibold text-stone-900">Front Desk</h2>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <nav className={`grid gap-1.5 lg:mt-6 lg:grid-cols-1 lg:gap-1.5 ${navItems.length > 4 ? "grid-cols-5" : "grid-cols-4"}`}>
          {navItems.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.label}
                href={item.href}
                aria-label={item.label}
                title={item.label}
                className={`flex min-h-14 items-center justify-center gap-2 rounded-[16px] px-2 text-xs font-medium transition lg:min-h-11 lg:w-full lg:justify-start lg:px-4 ${
                  isActive
                    ? "bg-stone-950 text-white"
                    : "text-stone-600 hover:bg-white hover:text-stone-900"
                }`}
              >
                <span className={isActive ? "text-white" : "text-stone-500"}>{item.icon}</span>
                <span className={isActive ? "text-white" : "text-stone-700"}>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="shrink-0 lg:mt-auto lg:w-full">
        <button
          type="button"
          aria-label="ログアウト"
          title="ログアウト"
          className="flex h-12 w-12 items-center justify-center rounded-[16px] text-stone-500 transition hover:bg-white hover:text-stone-900 lg:w-full lg:justify-start lg:gap-2 lg:px-4"
          onClick={onLogout}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none" stroke="currentColor" strokeWidth="1.8">
            <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
            <path d="M16 17l5-5-5-5M21 12H10" />
          </svg>
          <span className="hidden text-xs font-semibold lg:inline">ログアウト</span>
        </button>
      </div>
    </aside>
  );
}
