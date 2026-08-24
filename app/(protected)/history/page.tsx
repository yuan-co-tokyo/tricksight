import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRightIcon,
  BarChart3Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  VideoIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { skateAnalysisResultSchema } from "@/lib/analysis/schema";
import { requireCurrentUser } from "@/lib/current-user";
import {
  listActiveTricks,
  listPracticeSessions,
} from "@/lib/db/queries";
import { getHistoryCoverPresentation } from "@/lib/history-cover";
import { cn } from "@/lib/utils";

type HistoryPageProps = {
  searchParams: Promise<{
    trick?: string | string[];
    page?: string | string[];
    deleted?: string | string[];
  }>;
};

type HistorySession = Awaited<
  ReturnType<typeof listPracticeSessions>
>["items"][number];
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

function parseHistoryPage(value: string | undefined) {
  if (!value || !/^[1-9]\d*$/.test(value)) return 1;

  const page = Number(value);
  return Number.isSafeInteger(page) ? page : 1;
}

function historyPageHref(input: {
  trickSlug?: string;
  page?: number;
}) {
  const params = new URLSearchParams();

  if (input.trickSlug) params.set("trick", input.trickSlug);
  if (input.page && input.page > 1) params.set("page", String(input.page));

  const query = params.toString();
  return query ? `/history?${query}` : "/history";
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

function HistoryVideoCover({ session }: { session: HistorySession }) {
  const presentation = getHistoryCoverPresentation({
    trickName: session.trick.name,
    videoStatus: session.video?.status ?? null,
  });

  return (
    <div
      role="img"
      aria-label={presentation.accessibleLabel}
      className="relative isolate flex aspect-video overflow-hidden rounded-lg border border-primary/20 bg-card"
    >
      <span
        aria-hidden="true"
        className="absolute -top-12 -right-10 size-32 rounded-full bg-primary/10 blur-2xl"
      />
      <span
        aria-hidden="true"
        className="absolute -bottom-14 -left-8 size-28 rounded-full bg-muted blur-2xl"
      />
      <div className="relative flex min-w-0 flex-1 flex-col justify-between p-4">
        <div className="flex items-start justify-between gap-3">
          <span className="text-[0.65rem] font-semibold tracking-[0.2em] text-primary">
            {presentation.eyebrow}
          </span>
          <span className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/25 bg-primary/10 text-primary">
            <VideoIcon aria-hidden="true" className="size-4" />
          </span>
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-foreground">
            {session.trick.name}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {presentation.statusLabel}
          </p>
        </div>
      </div>
    </div>
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

function HistoryPagination({
  page,
  trickSlug,
  hasPreviousPage,
  hasNextPage,
}: {
  page: number;
  trickSlug?: string;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}) {
  if (!hasPreviousPage && !hasNextPage) return null;

  const navigationClassName =
    "inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-lg border border-border px-3 text-sm font-medium transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

  return (
    <nav
      aria-label="履歴のページ"
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-2"
    >
      {hasPreviousPage ? (
        <Link
          href={historyPageHref({ trickSlug, page: page - 1 })}
          className={cn(navigationClassName, "justify-self-stretch hover:bg-muted")}
        >
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
          前へ
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className={cn(
            navigationClassName,
            "justify-self-stretch text-muted-foreground opacity-50",
          )}
        >
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
          前へ
        </span>
      )}

      <span
        aria-current="page"
        className="px-1 text-sm font-medium whitespace-nowrap text-muted-foreground"
      >
        {page}ページ
      </span>

      {hasNextPage ? (
        <Link
          href={historyPageHref({ trickSlug, page: page + 1 })}
          className={cn(navigationClassName, "justify-self-stretch hover:bg-muted")}
        >
          次へ
          <ChevronRightIcon aria-hidden="true" className="size-4" />
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className={cn(
            navigationClassName,
            "justify-self-stretch text-muted-foreground opacity-50",
          )}
        >
          次へ
          <ChevronRightIcon aria-hidden="true" className="size-4" />
        </span>
      )}
    </nav>
  );
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const user = await requireCurrentUser();
  const requestedParams = await searchParams;
  const activeTricks = await listActiveTricks(user.id);
  const requestedTrick = firstSearchParam(requestedParams.trick);
  const requestedPage = firstSearchParam(requestedParams.page);
  const deletionCompleted = firstSearchParam(requestedParams.deleted) === "1";
  const selectedTrick = activeTricks.find(
    (trick) => trick.slug === requestedTrick,
  );
  const page = parseHistoryPage(requestedPage);

  if (
    requestedPage !== undefined &&
    (page === 1 || requestedPage !== String(page))
  ) {
    redirect(historyPageHref({ trickSlug: selectedTrick?.slug }));
  }

  const sessionPage = await listPracticeSessions(
    user.id,
    {
      ...(selectedTrick ? { trickSlug: selectedTrick.slug } : {}),
      page,
    },
  );
  const sessions = sessionPage.items;

  if (page > 1 && sessions.length === 0) {
    redirect(historyPageHref({ trickSlug: selectedTrick?.slug }));
  }

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">練習履歴</h1>
          <p className="text-sm text-muted-foreground">
            このページ {sessions.length}件
          </p>
        </div>
        <p className="text-muted-foreground">
          カードから練習動画と分析結果の確認や履歴の削除ができます。
        </p>
      </div>

      {deletionCompleted ? (
        <p
          role="status"
          className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm font-medium text-success"
        >
          動画と練習履歴を削除しました。
        </p>
      ) : null}

      <nav aria-label="トリックで履歴を絞り込む">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link
              href={historyPageHref({})}
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
                  href={historyPageHref({ trickSlug: trick.slug })}
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
        <div className="space-y-4">
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
                        <HistoryVideoCover session={session} />

                        <div className="min-w-0 space-y-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 space-y-1">
                              <h2 className="truncate text-lg font-semibold">
                                {session.trick.name}
                              </h2>
                              <p className="text-sm text-muted-foreground">
                                {practiceDateFormatter.format(
                                  session.practicedAt,
                                )}
                              </p>
                            </div>
                            <AnalysisStatusBadge session={session} />
                          </div>

                          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-background/40 p-3">
                            <div className="min-w-0 space-y-1">
                              <dt className="text-xs text-muted-foreground">
                                自己申告
                              </dt>
                              <dd
                                className={cn("font-medium", outcome.className)}
                              >
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
                            <ArrowRightIcon
                              aria-hidden="true"
                              className="size-3.5"
                            />
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
          <HistoryPagination
            page={sessionPage.page}
            trickSlug={selectedTrick?.slug}
            hasPreviousPage={sessionPage.hasPreviousPage}
            hasNextPage={sessionPage.hasNextPage}
          />
        </div>
      )}
    </section>
  );
}
