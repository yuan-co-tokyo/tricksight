import Link from "next/link";
import { ArrowRightIcon, BarChart3Icon, VideoIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { skateAnalysisResultSchema } from "@/lib/analysis/schema";
import { requireCurrentUser } from "@/lib/current-user";
import {
  listActiveTricks,
  listPracticeSessions,
} from "@/lib/db/queries";
import { cn } from "@/lib/utils";

type HistoryPageProps = {
  searchParams: Promise<{
    trick?: string | string[];
  }>;
};

type HistorySession = Awaited<ReturnType<typeof listPracticeSessions>>[number];
type AnalysisStatus = NonNullable<
  HistorySession["latestAnalysis"]
>["status"];

const analysisStatusPresentation = {
  QUEUED: {
    label: "分析待ち",
    className: "border-warning/30 bg-warning/10 text-warning",
  },
  ANALYZING: {
    label: "分析中",
    className: "border-primary/30 bg-primary/10 text-primary",
  },
  COMPLETED: {
    label: "分析完了",
    className: "border-success/30 bg-success/10 text-success",
  },
  FAILED: {
    label: "分析失敗",
    className: "border-error/30 bg-error/10 text-error",
  },
} satisfies Record<AnalysisStatus, { label: string; className: string }>;

const outcomePresentation = {
  LANDED: { label: "成功", className: "text-success" },
  BAILED: { label: "失敗", className: "text-error" },
  UNCLEAR: { label: "不明", className: "text-muted-foreground" },
} satisfies Record<
  HistorySession["userOutcome"],
  { label: string; className: string }
>;

const practiceDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "Asia/Tokyo",
});

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getCompletedScore(session: HistorySession) {
  if (session.latestAnalysis?.status !== "COMPLETED") return null;

  const result = skateAnalysisResultSchema.safeParse(
    session.latestAnalysis.resultJson,
  );
  if (!result.success) return null;

  const scores = Object.values(result.data.scores);
  return Math.round(
    scores.reduce((total, score) => total + score, 0) / scores.length,
  );
}

function AnalysisStatusBadge({ session }: { session: HistorySession }) {
  const status = session.latestAnalysis?.status;

  if (!status) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        未分析
      </Badge>
    );
  }

  const presentation = analysisStatusPresentation[status];

  return (
    <Badge variant="outline" className={presentation.className}>
      {presentation.label}
    </Badge>
  );
}

function EmptyHistory({ filtered }: { filtered: boolean }) {
  return (
    <Card>
      <CardContent className="grid min-h-72 place-items-center py-10 text-center">
        <div className="max-w-md space-y-5">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <VideoIcon aria-hidden="true" className="size-5" />
          </span>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">
              {filtered
                ? "このトリックの履歴はまだありません"
                : "まだ練習履歴がありません"}
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {filtered
                ? "別のトリックを選ぶか、スローモーション動画を用意して最初の分析を始めましょう。"
                : "スローモーションで撮影した練習動画を登録すると、分析結果と上達の記録をここで振り返れます。"}
            </p>
          </div>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            {filtered ? (
              <Link
                href="/history"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                すべての履歴を見る
              </Link>
            ) : null}
            <Link
              href="/videos/new"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-[#33ebff] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              新しい動画を分析する
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const user = await requireCurrentUser();
  const activeTricks = await listActiveTricks(user.id);
  const requestedTrick = firstSearchParam((await searchParams).trick);
  const selectedTrick = activeTricks.find(
    (trick) => trick.slug === requestedTrick,
  );
  const sessions = await listPracticeSessions(
    user.id,
    selectedTrick ? { trickSlug: selectedTrick.slug } : {},
  );

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">練習履歴</h1>
          <p className="text-sm text-muted-foreground">
            {sessions.length}件
          </p>
        </div>
        <p className="text-muted-foreground">
          過去の練習動画と分析結果を、トリックごとに振り返れます。
        </p>
      </div>

      <nav aria-label="トリックで履歴を絞り込む">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link
              href="/history"
              aria-current={!selectedTrick ? "page" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                !selectedTrick
                  ? "border-foreground/50 bg-muted text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              すべて
            </Link>
          </li>
          {activeTricks.map((trick) => {
            const selected = selectedTrick?.slug === trick.slug;

            return (
              <li key={trick.id}>
                <Link
                  href={{ pathname: "/history", query: { trick: trick.slug } }}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    selected
                      ? "border-foreground/50 bg-muted text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {trick.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {sessions.length === 0 ? (
        <EmptyHistory filtered={Boolean(selectedTrick)} />
      ) : (
        <ul className="grid gap-4" aria-label="練習セッション一覧">
          {sessions.map((session) => {
            const outcome = outcomePresentation[session.userOutcome];
            const completedScore = getCompletedScore(session);

            return (
              <li key={session.id}>
                <Link
                  href={`/history/${session.id}`}
                  prefetch={false}
                  aria-label={`${session.trick.name} ${practiceDateFormatter.format(session.practicedAt)}の詳細を見る`}
                  className="group block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <Card className="transition-colors group-hover:bg-muted/30">
                    <CardContent className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
                      {/* TODO(T8-1): S3の期限付きURLと生成済みサムネイルへ置き換える。 */}
                      <div className="grid aspect-video place-items-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground">
                        <span className="grid justify-items-center gap-2 text-xs">
                          <VideoIcon aria-hidden="true" className="size-6" />
                          サムネイル準備中
                        </span>
                      </div>

                      <div className="min-w-0 space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <h2 className="truncate text-lg font-semibold">
                              {session.trick.name}
                            </h2>
                            <p className="text-sm text-muted-foreground">
                              {practiceDateFormatter.format(session.practicedAt)}
                            </p>
                          </div>
                          <AnalysisStatusBadge session={session} />
                        </div>

                        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-background/40 p-3">
                          <div className="min-w-0 space-y-1">
                            <dt className="text-xs text-muted-foreground">
                              自己申告
                            </dt>
                            <dd className={cn("font-medium", outcome.className)}>
                              {outcome.label}
                            </dd>
                          </div>
                          <div className="min-w-0 space-y-1 border-l border-border pl-3">
                            <dt className="text-xs text-muted-foreground">
                              総合スコア
                            </dt>
                            <dd className="flex items-baseline gap-1 font-medium">
                              {completedScore === null ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <>
                                  <BarChart3Icon
                                    aria-hidden="true"
                                    className="size-4 text-success"
                                  />
                                  <span>{completedScore}</span>
                                  <span className="text-xs font-normal text-muted-foreground">
                                    / 100
                                  </span>
                                </>
                              )}
                            </dd>
                          </div>
                        </dl>

                        <span className="flex items-center justify-end gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                          詳細を見る
                          <ArrowRightIcon aria-hidden="true" className="size-3.5" />
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
