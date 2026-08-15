import Link from "next/link";
import {
  ArrowRightIcon,
  CheckIcon,
  ClapperboardIcon,
  HistoryIcon,
  SparklesIcon,
  UploadIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/current-user";

const experienceSteps = [
  {
    title: "トリックを選ぶ",
    description: "分析したいトリックと撮影条件を入力します。",
    icon: CheckIcon,
  },
  {
    title: "動画をアップロード",
    description: "スローモーションで書き出した練習動画を送ります。",
    icon: UploadIcon,
  },
  {
    title: "AIが分析",
    description: "アップロード後、動画の分析完了を待ちます。",
    icon: SparklesIcon,
  },
  {
    title: "次の練習を確認",
    description: "良かった点、改善点、次回の練習内容を確認します。",
    icon: ClapperboardIcon,
  },
  {
    title: "履歴で振り返る",
    description: "過去の動画と分析結果を残し、上達を振り返ります。",
    icon: HistoryIcon,
  },
] as const;

const supportedTricks = ["Ollie", "Pop Shove-it", "Kickflip"] as const;

export default async function Home() {
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link
            href="/"
            aria-label="tricksight ホーム"
            className="shrink-0 rounded-md text-lg font-black tracking-[0.12em] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            trick<span className="text-primary">sight</span>
          </Link>

          {user ? (
            <Button
              nativeButton={false}
              render={<Link href="/dashboard" />}
              size="sm"
            >
              ダッシュボードへ
              <ArrowRightIcon aria-hidden="true" />
            </Button>
          ) : (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Button
                nativeButton={false}
                render={<Link href="/login" />}
                variant="ghost"
                size="sm"
              >
                ログイン
              </Button>
              <Button
                nativeButton={false}
                render={<Link href="/register" />}
                size="sm"
              >
                新規登録
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)] lg:items-center lg:py-24">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase sm:text-sm">
              AI VIDEO ANALYSIS FOR SKATEBOARDING
            </p>
            <h1 className="mt-5 text-4xl leading-[1.05] font-black tracking-[-0.04em] text-foreground uppercase sm:text-6xl lg:text-7xl">
              SEE YOUR TRICK.
              <br />
              SHAPE YOUR PROGRESS.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              スケートボードの練習動画をAIが分析し、良かった点、改善点、次回の練習内容を整理します。動画と分析結果を履歴に残し、これまでの上達を振り返れます。
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                nativeButton={false}
                render={<Link href={user ? "/dashboard" : "/register"} />}
                size="lg"
                className="w-full sm:w-auto"
              >
                {user ? "ダッシュボードへ" : "分析を始める"}
                <ArrowRightIcon aria-hidden="true" />
              </Button>
              <Button
                nativeButton={false}
                render={<Link href={user ? "/profile" : "/login"} />}
                variant="outline"
                size="lg"
                className="w-full sm:w-auto"
              >
                {user ? "プロフィールを見る" : "ログイン"}
              </Button>
            </div>
          </div>

          <aside className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <p className="text-sm font-semibold text-foreground">
              撮影前にご確認ください
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">
              スローモーション撮影が必要です
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              分析には、スローモーションで再生される状態に書き出した動画を使用してください。通常速度の動画では、トリック中の細かな動きを十分に捉えられません。
            </p>
            <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-border pt-5 text-center">
              <div className="min-w-0 rounded-lg bg-muted px-1 py-3">
                <dt className="text-xs text-muted-foreground">形式</dt>
                <dd className="mt-1 text-sm font-medium">MP4 / MOV</dd>
              </div>
              <div className="min-w-0 rounded-lg bg-muted px-1 py-3">
                <dt className="text-xs text-muted-foreground">長さ</dt>
                <dd className="mt-1 text-sm font-medium">3〜20秒</dd>
              </div>
              <div className="min-w-0 rounded-lg bg-muted px-1 py-3">
                <dt className="text-xs text-muted-foreground">サイズ</dt>
                <dd className="mt-1 text-sm font-medium">最大100MB</dd>
              </div>
            </dl>
          </aside>
        </section>

        <section className="border-y border-border bg-card">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-wide text-muted-foreground">
                練習から振り返りまで
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                1本の動画を、次の練習につなげる
              </h2>
            </div>

            <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {experienceSteps.map((step, index) => {
                const Icon = step.icon;

                return (
                  <li
                    key={step.title}
                    className="rounded-xl border border-border bg-background p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Icon
                        aria-hidden="true"
                        className="size-5 text-muted-foreground"
                      />
                      <span className="text-xs font-medium text-muted-foreground">
                        0{index + 1}
                      </span>
                    </div>
                    <h3 className="mt-5 font-semibold">{step.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {step.description}
                    </p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center">
          <div>
            <p className="text-sm font-semibold tracking-wide text-muted-foreground">
              MVP SUPPORTED TRICKS
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              対応トリックは3種類
            </h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
              分析前に自分でトリックを選択します。AIによるトリックの自動判定ではなく、選んだトリックに合わせて動画を分析します。
            </p>
          </div>

          <ul className="grid gap-3 sm:grid-cols-3">
            {supportedTricks.map((trick) => (
              <li
                key={trick}
                className="rounded-xl border border-border bg-card px-4 py-6 text-center text-lg font-semibold"
              >
                {trick}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="font-semibold text-foreground">
            trick<span className="text-primary">sight</span>
          </p>
          <p>練習動画を分析し、次の一歩を記録する。</p>
        </div>
      </footer>
    </div>
  );
}
