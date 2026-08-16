import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  BarChart3Icon,
  CalendarDaysIcon,
  CameraIcon,
  CheckCircle2Icon,
  Clock3Icon,
  FileVideoIcon,
  LightbulbIcon,
  SparklesIcon,
  TargetIcon,
  VideoIcon,
  XCircleIcon,
} from "lucide-react";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCurrentUser } from "@/lib/current-user";
import { getPracticeSessionDetail } from "@/lib/db/queries";
import {
  formatTimestampSeconds,
  getCompletedAnalysisResult,
} from "@/lib/history-detail";
import { cn } from "@/lib/utils";

type HistoryDetailPageProps = {
  params: Promise<{ sessionId: string }>;
};

type HistoryDetail = NonNullable<
  Awaited<ReturnType<typeof getPracticeSessionDetail>>
>;
type AnalysisStatus = NonNullable<
  HistoryDetail["latestAnalysis"]
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

const cameraAngleLabels = {
  SIDE: "横",
  FRONT: "正面",
  REAR: "後方",
  DIAGONAL: "斜め",
} satisfies Record<HistoryDetail["cameraAngle"], string>;

const outcomePresentation = {
  LANDED: { label: "成功", className: "text-success" },
  BAILED: { label: "失敗", className: "text-error" },
  UNCLEAR: { label: "不明", className: "text-muted-foreground" },
} satisfies Record<
  HistoryDetail["userOutcome"],
  { label: string; className: string }
>;

const scoreLabels = {
  setup: "構え",
  pop: "ポップ",
  bodyBalance: "体のバランス",
  footControl: "足のコントロール",
  landing: "着地",
} as const;

const practiceDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tokyo",
});

const analysisDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Tokyo",
});

function AnalysisStatusBadge({
  analysis,
}: {
  analysis: HistoryDetail["latestAnalysis"];
}) {
  if (!analysis) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        未分析
      </Badge>
    );
  }

  const presentation = analysisStatusPresentation[analysis.status];

  return (
    <Badge variant="outline" className={presentation.className}>
      {presentation.label}
    </Badge>
  );
}

function StatusNotice({
  title,
  description,
  tone = "muted",
}: {
  title: string;
  description: string;
  tone?: "muted" | "primary" | "error" | "warning";
}) {
  const toneClassNames = {
    muted: "border-border bg-muted/40 text-muted-foreground",
    primary: "border-primary/30 bg-primary/10 text-primary",
    error: "border-error/30 bg-error/10 text-error",
    warning: "border-warning/30 bg-warning/10 text-warning",
  } as const;

  return (
    <div className={cn("rounded-lg border p-4", toneClassNames[tone])}>
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm leading-6">{description}</p>
    </div>
  );
}

function AnalysisResult({
  analysis,
}: {
  analysis: HistoryDetail["latestAnalysis"];
}) {
  if (!analysis) {
    return (
      <StatusNotice
        title="分析はまだ開始されていません"
        description="動画の登録後に分析が始まると、ここに結果が表示されます。"
      />
    );
  }

  if (analysis.status === "QUEUED") {
    return (
      <StatusNotice
        title="分析の開始を待っています"
        description="順番に処理しています。分析結果が届くまでしばらくお待ちください。"
        tone="primary"
      />
    );
  }

  if (analysis.status === "ANALYZING") {
    return (
      <StatusNotice
        title="AIが動画を分析しています"
        description="動きとフォームを確認しています。完了後に5項目のスコアと改善点が表示されます。"
        tone="primary"
      />
    );
  }

  if (analysis.status === "FAILED") {
    return (
      <>
        <StatusNotice
          title="分析に失敗しました"
          description="分析結果を取得できませんでした。時間をおいてからもう一度お試しください。"
          tone="error"
        />
        {/* TODO(T6-5): 再分析処理の実装時に操作導線を追加する。この段階ではボタンを置かない。 */}
      </>
    );
  }

  const result = getCompletedAnalysisResult(analysis);

  if (!result) {
    return (
      <StatusNotice
        title="分析結果を表示できません"
        description="保存された結果の形式を確認できませんでした。"
        tone="warning"
      />
    );
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="analysis-summary-heading" className="space-y-2">
        <h3
          id="analysis-summary-heading"
          className="flex items-center gap-2 font-semibold"
        >
          <SparklesIcon aria-hidden="true" className="size-4 text-primary" />
          AI総評
        </h3>
        <p className="leading-7 text-muted-foreground">{result.summary}</p>
      </section>

      <section aria-labelledby="analysis-scores-heading" className="space-y-3">
        <h3
          id="analysis-scores-heading"
          className="flex items-center gap-2 font-semibold"
        >
          <BarChart3Icon aria-hidden="true" className="size-4 text-primary" />
          5項目スコア
        </h3>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(scoreLabels).map(([key, label]) => {
            const score = result.scores[key as keyof typeof result.scores];

            return (
              <div
                key={key}
                className="min-w-0 rounded-lg border border-border bg-background/40 p-3"
              >
                <dt className="text-xs leading-5 text-muted-foreground">
                  {label}
                </dt>
                <dd className="mt-1 flex items-baseline gap-1">
                  <span className="text-xl font-semibold text-primary">
                    {score}
                  </span>
                  <span className="text-xs text-muted-foreground">/ 100</span>
                </dd>
                <div
                  aria-hidden="true"
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${score}%` }}
                  />
                </div>
              </div>
            );
          })}
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="strengths-heading" className="space-y-3">
          <h3
            id="strengths-heading"
            className="flex items-center gap-2 font-semibold"
          >
            <CheckCircle2Icon
              aria-hidden="true"
              className="size-4 text-success"
            />
            良かった点
          </h3>
          {result.strengths.length === 0 ? (
            <p className="text-sm text-muted-foreground">記録はありません。</p>
          ) : (
            <ul className="grid gap-3">
              {result.strengths.map((strength, index) => (
                <li
                  key={`${strength.title}-${index}`}
                  className="rounded-lg border border-success/20 bg-success/5 p-3"
                >
                  <p className="font-medium">{strength.title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {strength.description}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="improvements-heading" className="space-y-3">
          <h3
            id="improvements-heading"
            className="flex items-center gap-2 font-semibold"
          >
            <LightbulbIcon aria-hidden="true" className="size-4 text-warning" />
            改善点
          </h3>
          {result.improvements.length === 0 ? (
            <p className="text-sm text-muted-foreground">記録はありません。</p>
          ) : (
            <ol className="grid gap-3">
              {result.improvements.map((improvement) => (
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
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {improvement.description}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section
        aria-labelledby="next-practice-heading"
        className="rounded-lg border border-primary/20 bg-primary/5 p-4"
      >
        <h3
          id="next-practice-heading"
          className="flex items-center gap-2 font-semibold"
        >
          <TargetIcon aria-hidden="true" className="size-4 text-primary" />
          次回の練習
        </h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">集中すること</dt>
            <dd className="mt-1 font-medium">{result.nextPractice.focus}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">ドリル</dt>
            <dd className="mt-1 leading-6">{result.nextPractice.drill}</dd>
          </div>
        </dl>
      </section>

      {result.safetyNote ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm leading-6 text-muted-foreground">
          安全メモ: {result.safetyNote}
        </p>
      ) : null}
    </div>
  );
}

function AnalysisMetadata({
  analysis,
}: {
  analysis: NonNullable<HistoryDetail["latestAnalysis"]>;
}) {
  const analyzedAt =
    analysis.completedAt ?? analysis.startedAt ?? analysis.createdAt;

  return (
    <Card>
      <CardHeader>
        <CardTitle>分析モデルと日時</CardTitle>
        <CardDescription>
          この結果を生成した分析設定の記録です。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Provider</dt>
            <dd className="mt-1 break-all font-medium">{analysis.provider}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Model ID</dt>
            <dd className="mt-1 break-all font-medium">{analysis.modelId}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Prompt version</dt>
            <dd className="mt-1 break-all font-medium">
              {analysis.promptVersion}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">分析日時</dt>
            <dd className="mt-1 font-medium">
              {analysisDateFormatter.format(analyzedAt)}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

export default async function HistoryDetailPage({
  params,
}: HistoryDetailPageProps) {
  const user = await requireCurrentUser();
  const { sessionId } = await params;

  if (!z.uuid().safeParse(sessionId).success) notFound();

  const session = await getPracticeSessionDetail(user.id, sessionId);

  if (!session) notFound();

  const outcome = outcomePresentation[session.userOutcome];

  return (
    <article className="space-y-6">
      <header className="space-y-4">
        <Link
          href="/history"
          className="inline-flex min-h-9 items-center gap-2 rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          履歴一覧へ戻る
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-primary">練習履歴の詳細</p>
            <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">
              {session.trick.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {practiceDateFormatter.format(session.practicedAt)}
            </p>
          </div>
          <AnalysisStatusBadge analysis={session.latestAnalysis} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(16rem,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>過去動画</CardTitle>
            <CardDescription>
              登録した練習動画を確認するエリアです。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* TODO(T5-4): S3の期限付き再生URLを発行し、動画プレーヤーへ置き換える。 */}
            <div className="grid aspect-video place-items-center overflow-hidden rounded-lg border border-border bg-muted text-center text-muted-foreground">
              <span className="grid max-w-xs justify-items-center gap-2 px-4 text-sm">
                <VideoIcon aria-hidden="true" className="size-8" />
                <span className="font-medium text-foreground">
                  動画再生は準備中です
                </span>
                <span className="text-xs leading-5">
                  期限付き再生URLは次の実装で追加します。
                </span>
              </span>
            </div>
            {session.video ? (
              <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <FileVideoIcon aria-hidden="true" className="size-4 shrink-0" />
                <span className="truncate" title={session.video.originalFilename}>
                  {session.video.originalFilename}
                </span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                この練習に登録された動画はありません。
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>登録時の情報</CardTitle>
            <CardDescription>練習時に記録した内容です。</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <div className="min-w-0">
                <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                  <SparklesIcon aria-hidden="true" className="size-3.5" />
                  トリック
                </dt>
                <dd className="mt-1 font-medium">{session.trick.name}</dd>
              </div>
              <div className="min-w-0">
                <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarDaysIcon aria-hidden="true" className="size-3.5" />
                  練習日
                </dt>
                <dd className="mt-1 font-medium">
                  {practiceDateFormatter.format(session.practicedAt)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CameraIcon aria-hidden="true" className="size-3.5" />
                  撮影方向
                </dt>
                <dd className="mt-1 font-medium">
                  {cameraAngleLabels[session.cameraAngle]}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                  {session.userOutcome === "BAILED" ? (
                    <XCircleIcon aria-hidden="true" className="size-3.5" />
                  ) : (
                    <CheckCircle2Icon aria-hidden="true" className="size-3.5" />
                  )}
                  成功・失敗の自己申告
                </dt>
                <dd className={cn("mt-1 font-medium", outcome.className)}>
                  {outcome.label}
                </dd>
              </div>
              <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                <dt className="text-xs text-muted-foreground">メモ</dt>
                <dd className="mt-1 break-words whitespace-pre-wrap leading-6">
                  {session.memo || "メモはありません。"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <CardTitle>AI分析結果</CardTitle>
              <CardDescription>
                動画から確認したフォームと次の練習ポイントです。
              </CardDescription>
            </div>
            <AnalysisStatusBadge analysis={session.latestAnalysis} />
          </div>
        </CardHeader>
        <CardContent>
          <AnalysisResult analysis={session.latestAnalysis} />
        </CardContent>
      </Card>

      {session.latestAnalysis ? (
        <AnalysisMetadata analysis={session.latestAnalysis} />
      ) : null}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock3Icon aria-hidden="true" className="size-3.5" />
        履歴登録日時: {analysisDateFormatter.format(session.createdAt)}
      </p>
    </article>
  );
}
