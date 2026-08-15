import Link from "next/link";

import { AppNavigation } from "@/components/app-navigation";
import { LogoutButton } from "@/components/logout-button";
import { requireCurrentUser } from "@/lib/current-user";

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireCurrentUser();

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto grid w-full max-w-5xl gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <Link
              href="/dashboard"
              aria-label="tricksight ダッシュボード"
              className="shrink-0 rounded-md text-lg font-black tracking-[0.12em] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              trick<span className="text-primary">sight</span>
            </Link>
            <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
              <p
                title={user.name}
                className="max-w-28 truncate text-sm text-muted-foreground sm:max-w-56"
              >
                <span className="sr-only">ログイン中: </span>
                {user.name}
              </p>
              <LogoutButton />
            </div>
          </div>
          <AppNavigation />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
