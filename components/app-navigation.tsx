"use client";

import Link from "next/link";
import { HistoryIcon, LayoutDashboardIcon, UserRoundIcon } from "lucide-react";
import { usePathname } from "next/navigation";

import { PROTECTED_ROUTE_PREFIXES } from "@/lib/auth-routes";
import { cn } from "@/lib/utils";

type ProtectedRoute = (typeof PROTECTED_ROUTE_PREFIXES)[number];

type NavigationItem = {
  href: ProtectedRoute;
  label: string;
  icon: typeof LayoutDashboardIcon;
  available: boolean;
};

const navigationItems = [
  {
    href: "/dashboard",
    label: "ダッシュボード",
    icon: LayoutDashboardIcon,
    available: true,
  },
  {
    href: "/history",
    label: "履歴",
    icon: HistoryIcon,
    available: false,
  },
  {
    href: "/profile",
    label: "プロフィール",
    icon: UserRoundIcon,
    available: true,
  },
] satisfies readonly NavigationItem[];

export function AppNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="メインナビゲーション">
      <ul className="grid grid-cols-3 gap-1 sm:flex sm:items-center">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.available &&
            (pathname === item.href || pathname.startsWith(`${item.href}/`));
          const content = (
            <>
              <Icon
                aria-hidden="true"
                className="hidden size-4 shrink-0 sm:block"
              />
              <span className="truncate">{item.label}</span>
              {!item.available ? (
                <span className="text-[0.625rem] leading-none sm:ml-0.5">
                  準備中
                </span>
              ) : null}
            </>
          );
          const className = cn(
            "flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border px-0.5 py-2 text-xs font-medium transition-colors sm:min-h-0 sm:flex-row sm:gap-1 sm:px-3 sm:text-sm",
            isActive
              ? "border-primary/40 bg-sidebar-accent text-primary"
              : "border-transparent text-muted-foreground",
          );

          return (
            <li key={item.href} className="min-w-0">
              {item.available ? (
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    className,
                    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    isActive
                      ? "hover:bg-sidebar-accent hover:text-primary"
                      : "hover:bg-muted hover:text-foreground",
                  )}
                >
                  {content}
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  title="履歴画面は準備中です"
                  className={cn(className, "cursor-not-allowed opacity-60")}
                >
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
