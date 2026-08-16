import Link from "next/link";
import {
  ArrowRightIcon,
  BarChart3Icon,
  CalendarDaysIcon,
  Clock3Icon,
  LightbulbIcon,
  PlusIcon,
  SparklesIcon,
  TargetIcon,
  VideoIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCurrentUser } from "@/lib/current-user";
import { getDashboardSummary } from "@/lib/db/queries";
import {
  formatTimestampSeconds,
  getCompletedAnalysisResult,
} from "@/lib/history-detail";
import { cn } from "@/lib/utils";

type DashboardSummary = Awaited<ReturnType<typeof getDashboardSummary>>;
type LatestAnalysis = NonNullable<DashboardSummary["latestAnalysis"]>;
type AnalysisStatus = LatestAnalysis["analysis"]["status"];

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
  DashboardSummary["recentVideos"][number]["userOutcome"],
  { label: string; className: string }
>;

const videoStatusLabels = {
  PENDING_UPLOAD: "アップロード待ち",
  UPLOADED: "処理待ち",
  READY: "登録済み",
  FAILED: "動画処理失敗",
} satisfies Record<
  DashboardSummary["recentVideos"][number]["video"]["status"],
  string
>;

const practiceDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "Asia/Tokyo",
});

function AnalyzeVideoButton() {
  return (
    <Button
      size="lg"
      className="w-full sm:w-auto"
      nativeButton={false}
      render={<Link href="/videos/new" />}
    >
      <PlusIcon aria-hidden="true" />
      新しい動画を分析する
    </Button>
  );
}

function AnalysisStatusBadge({ status }: { status: AnalysisStatus }) {
  const presentation = analysisStatusPresentation[status];

  return (
    <Badge variant="outline" className={presentation.className}>
      {presentation.label}
    </Badge>
  );
}

function averageScore(scores: Record<string, number>) {
  const values = Object.values(scores);
  return Math.round(
    values.reduce((total, score) => total + score, 0) / values.length,
  );
}

function LatestAnalysisCard({
  latestAnalysis,
}: {
  latestAnalysis: LatestAnalysis;
}) {
  const result = getCompletedAnalysisResult(latestAnalysis.analysis);
  const status = latestAnalysis.analysis.status;
  const statusCopy = {
    QUEUED: "分析の開始を待っています。",
    ANALYZING: "AIが動画の動きとフォームを分析しています。",
    COMPLETED: result
      ? result.summary
      : "分析は完了しましたが、結果を表示できません。",
    FAILED: "分析結果を取得できませんでした。詳細画面で状態を確認できます。",
  } satisfies Record<AnalysisStatus, string>;

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <SparklesIcon aria-hidden="true" className="size-4" />
              最新の分析
            </CardTitle>
            <CardDescription>
              直近に受け付けた分析の現在の状態です。
            </CardDescription>
          </div>
          <AnalysisStatusBadge status={status} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">
              {latestAnalysis.trick.name}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDaysIcon aria-hidden="true" className="size-3.5" />
              {practiceDateFormatter.format(latestAnalysis.practicedAt)}
            </p>
          </div>
          {result ? (
            <div className="shrink-0 text-right">
              <p className="text-xs text-muted-foreground">総合スコア</p>
              <p className="flex items-baseline justify-end gap-1">
                <span className="text-3xl font-semibold text-primary">
                  {averageScore(result.scores)}
                </span>
                <span className="text-xs text-muted-foreground">/ 100</span>
              </p>
            </div>
          ) : null}
        </div>

        <p className="line-clamp-3 leading-6 text-muted-foreground">
          {statusCopy[status]}
        </p>

        <Link
          href={`/history/${latestAnalysis.sessionId}`}
          className="mt-auto inline-flex min-h-9 items-center justify-end gap-1 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          分析詳細を見る
          <ArrowRightIcon aria-hidden="true" className="size-4" />
        </Link>
      </CardContent>
    </Card>
  );
}

function LatestImprovementsCard({
  latestCompletedAnalysis,
}: {
  latestCompletedAnalysis: DashboardSummary["latestCompletedAnalysis"];
}) {
  const result = getCompletedAnalysisResult(
    latestCompletedAnalysis?.analysis ?? null,
  );
  const improvements = result?.improvements.slice(0, 3) ?? [];

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LightbulbIcon aria-hidden="true" className="size-4" />
          最新の改善ポイント
        </CardTitle>
        <CardDescription>
          直近の完了済み分析から、優先度順に表示します。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {latestCompletedAnalysis && improvements.length > 0 ? (
          <>
            <ol className="grid gap-3">
              {improvements.map((improvement) => (
                <li
                  key={`${improvement.priority}-${improvement.title}`}
                  className="rounded-lg border border-warning/20 bg-warning/5 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className="border-warning/30 text-warning"
                    >
                      優先度 {improvement.priority}
                    </Badge>
                    {improvement.timestampSeconds !== undefined ? (
                      <span className="text-xs text-muted-foreground">
                        動画 {formatTimestampSeconds(improvement.timestampSeconds)} 地点
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 font-medium">{improvement.title}</p>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                    {improvement.description}
                  </p>
                </li>
              ))}
            </ol>
            <Link
              href={`/history/${latestCompletedAnalysis.sessionId}`}
              className="mt-auto inline-flex min-h-9 items-center justify-end gap-1 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              改善点の詳細を見る
              <ArrowRightIcon aria-hidden="true" className="size-4" />
            </Link>
          </>
        ) : (
          <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-border p-6 text-center">
            <div className="max-w-xs space-y-2">
              <TargetIcon
                aria-hidden="true"
                className="mx-auto size-6 text-muted-foreground"
              />
              <p className="font-medium">改善ポイントはまだありません</p>
              <p className="text-sm leading-6 text-muted-foreground">
                分析が完了すると、次の練習で優先したいポイントがここに表示されます。
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecentVideosCard({
  recentVideos,
}: {
  recentVideos: DashboardSummary["recentVideos"];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <VideoIcon aria-hidden="true" className="size-4" />
              最近投稿した動画
            </CardTitle>
            <CardDescription>
              新しく登録した練習から最大5件を表示します。
            </CardDescription>
          </div>
          <Link
            href="/history"
            className="rounded-lg text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            すべて見る
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border" aria-label="最近投稿した動画">
          {recentVideos.map((item) => {
            const outcome = outcomePresentation[item.userOutcome];

            return (
              <li key={item.video.id}>
                <Link
                  href={`/history/${item.sessionId}`}
                  className="group grid min-w-0 gap-3 rounded-lg py-3 transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-center sm:px-2"
                >
                  <span className="grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <VideoIcon aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">{item.trick.name}</span>
                      <span className={cn("text-xs", outcome.className)}>
                        {outcome.label}
                      </span>
                    </span>
                    <span
                      title={item.video.originalFilename}
                      className="mt-1 block truncate text-xs text-muted-foreground"
                    >
                      {item.video.originalFilename}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-3 pl-13 text-xs text-muted-foreground sm:justify-end sm:pl-0">
                    <span className="grid justify-items-start gap-0.5 sm:justify-items-end">
                      <span>{practiceDateFormatter.format(item.practicedAt)}</span>
                      <span>{videoStatusLabels[item.video.status]}</span>
                    </span>
                    <ArrowRightIcon
                      aria-hidden="true"
                      className="size-4 transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function TrickCountsCard({
  trickCounts,
}: {
  trickCounts: DashboardSummary["trickCounts"];
}) {
  const maxCount = Math.max(
    1,
    ...trickCounts.map((item) => Number(item.postCount)),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3Icon aria-hidden="true" className="size-4" />
          トリック別の投稿数
        </CardTitle>
        <CardDescription>
          トリックを選ぶと、その履歴一覧へ移動します。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3">
          {trickCounts.map((item) => {
            const count = Number(item.postCount);

            return (
              <li key={item.trickId}>
                <Link
                  href={{
                    pathname: "/history",
                    query: { trick: item.trickSlug },
                  }}
                  className="group grid gap-2 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate font-medium">
                      {item.trickName}
                    </span>
                    <span className="shrink-0 text-sm text-muted-foreground">
                      {count}件
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${(count / maxCount) * 100}%` }}
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function EmptyDashboard() {
  return (
    <Card>
      <CardContent className="grid min-h-80 place-items-center py-10 text-center">
        <div className="max-w-lg space-y-5">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
            <VideoIcon aria-hidden="true" className="size-6" />
          </span>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">
              まだ練習動画がありません
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              まずは横から全身とボードが映るスローモーション動画を用意してください。3〜20秒のMP4またはMOVから、AI分析の準備を始められます。
            </p>
          </div>
          <AnalyzeVideoButton />
        </div>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const user = await requireCurrentUser();
  const summary = await getDashboardSummary(user.id, {
    recentVideoLimit: 5,
  });
  const empty =
    summary.latestAnalysis === null &&
    summary.recentVideos.length === 0 &&
    summary.trickCounts.length === 0;

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            ダッシュボード
          </h1>
          <p className="text-muted-foreground">
            練習動画の分析結果と上達の記録を、ここから確認できます。
          </p>
        </div>
        <AnalyzeVideoButton />
      </header>

      {empty ? (
        <EmptyDashboard />
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            {summary.latestAnalysis ? (
              <LatestAnalysisCard latestAnalysis={summary.latestAnalysis} />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>最新の分析</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  分析結果はまだありません。
                </CardContent>
              </Card>
            )}
            <LatestImprovementsCard
              latestCompletedAnalysis={summary.latestCompletedAnalysis}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]">
            <RecentVideosCard recentVideos={summary.recentVideos} />
            <TrickCountsCard trickCounts={summary.trickCounts} />
          </div>
        </>
      )}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock3Icon aria-hidden="true" className="size-3.5" />
        データはログイン中のアカウントに紐づく練習だけを表示しています。
      </p>
    </section>
  );
}
