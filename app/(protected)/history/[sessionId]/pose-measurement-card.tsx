import Link from "next/link";
import {
  ActivityIcon,
  ArrowRightIcon,
  MoveVerticalIcon,
  TriangleAlertIcon,
  VideoIcon,
} from "lucide-react";

import { buttonVariants } from "../../../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card";
import {
  describeHipVerticalRangeChange,
  describeKneeAngleChange,
  type DisplayedPoseMetrics,
  type PoseHistoryComparisonState,
} from "../../../../lib/pose/history-comparison";
import { cn } from "../../../../lib/utils";

const comparisonDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tokyo",
});

const cameraAngleLabels = {
  SIDE: "横",
  FRONT: "正面",
  REAR: "後方",
  DIAGONAL: "斜め",
} as const;

const videoSpeedLabels = {
  NORMAL: "通常",
  SLOW_MOTION: "スローモーション",
} as const;

// The Worker also persists knee extension range for later evaluation, but the
// MVP stays focused on two understandable values. Landing trunk tilt remains
// hidden because T11-1 contradicted the hypothesis and gave us no responsible
// user-facing interpretation for it.
function CurrentMetricValues({ metrics }: { metrics: DisplayedPoseMetrics }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <div className="min-w-0 rounded-lg border border-border bg-background/40 p-4">
        <dt className="flex items-center gap-2 text-sm font-medium">
          <ActivityIcon
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
          膝の曲がり
        </dt>
        <dd className="mt-2 block text-2xl font-semibold tabular-nums">
          {metrics.minimumMeanKneeAngleDeg.toFixed(1)}°
        </dd>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          左右の膝角度平均が動画内で最小になった値です。成績や成功判定ではありません。
        </p>
      </div>
      <div className="min-w-0 rounded-lg border border-border bg-background/40 p-4">
        <dt className="flex items-center gap-2 text-sm font-medium">
          <MoveVerticalIcon
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
          腰の上下動
        </dt>
        <dd className="mt-2 block text-2xl font-semibold tabular-nums">
          {metrics.hipVerticalRangeTorsoUnits.toFixed(1)} 胴長
        </dd>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          胴長を1とした動画内の相対的な動きです。絶対的な跳躍高ではありません。
        </p>
      </div>
    </dl>
  );
}

function ComparisonMetrics({ state }: { state: Extract<PoseHistoryComparisonState, { kind: "comparison" }> }) {
  const { current, previous } = state;

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <div className="min-w-0 rounded-lg border border-border bg-background/40 p-4">
        <dt className="flex items-center gap-2 text-sm font-medium">
          <ActivityIcon
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
          膝の曲がり
        </dt>
        <dd className="mt-2 block text-2xl font-semibold tabular-nums">
          {current.minimumMeanKneeAngleDeg.toFixed(1)}°
        </dd>
        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
          前回 {previous.minimumMeanKneeAngleDeg.toFixed(1)}°
        </p>
        <p className="mt-3 text-sm font-medium">
          {describeKneeAngleChange(
            current.minimumMeanKneeAngleDeg,
            previous.minimumMeanKneeAngleDeg,
          )}
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          左右の膝角度平均が動画内で最小になった値です。変化に良し悪しは付けていません。
        </p>
      </div>
      <div className="min-w-0 rounded-lg border border-border bg-background/40 p-4">
        <dt className="flex items-center gap-2 text-sm font-medium">
          <MoveVerticalIcon
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
          腰の上下動
        </dt>
        <dd className="mt-2 block text-2xl font-semibold tabular-nums">
          {current.hipVerticalRangeTorsoUnits.toFixed(1)} 胴長
        </dd>
        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
          前回 {previous.hipVerticalRangeTorsoUnits.toFixed(1)} 胴長
        </p>
        <p className="mt-3 text-sm font-medium">
          {describeHipVerticalRangeChange(
            current.hipVerticalRangeTorsoUnits,
            previous.hipVerticalRangeTorsoUnits,
          )}
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          胴長を1とした動画内の相対的な動きです。絶対的な跳躍高ではありません。
        </p>
      </div>
    </dl>
  );
}

function baselineReason(state: Extract<PoseHistoryComparisonState, { kind: "baseline" }>) {
  switch (state.reason) {
    case "NO_SAME_TRICK_MEASUREMENT":
      return {
        reason: "同じ技の比較可能な過去計測がありません。",
        guidance: null,
      };
    case "VIDEO_SPEED":
      return {
        reason: "撮影速度が異なる、または過去履歴の撮影速度が不明です。",
        guidance: state.currentVideoSpeed
          ? `次回も撮影速度を「${videoSpeedLabels[state.currentVideoSpeed]}」に合わせてください。`
          : "次回から撮影速度を選び、以降も同じ速度に合わせてください。",
      };
    case "CAMERA_ANGLE":
      return {
        reason: "撮影角度が過去の計測と異なります。",
        guidance: `次回も撮影方向を「${cameraAngleLabels[state.currentCameraAngle]}」に合わせてください。`,
      };
    case "PROCESS_OR_RUNTIME":
      return {
        reason: "処理版またはブラウザ系統が過去の計測と異なります。",
        guidance: null,
      };
  }
}

function unassessableCopy(
  status: Extract<PoseHistoryComparisonState, { kind: "unassessable" }>["status"],
) {
  switch (status) {
    case "UNASSESSABLE":
      return {
        title: "人物または足元を十分な時間検出できませんでした",
        description:
          "横から全身と足先を画角に入れ、人物の大きさを一定にして、必要ならスローモーションで撮影してください。",
      };
    case "FAILED":
      return {
        title: "この動画ではフォーム計測を完了できませんでした",
        description:
          "AI分析はそのまま確認できます。必要な場合だけ、別の動画で再度お試しください。",
      };
    case "TIMED_OUT":
      return {
        title: "フォーム計測に時間がかかったため省略しました",
        description:
          "AI分析はそのまま確認できます。必要な場合だけ、短い動画で再度お試しください。",
      };
    case "CANCELED":
      return {
        title: "フォーム計測は中止されました",
        description:
          "AI分析には影響ありません。必要な場合だけ、別の動画を登録してください。",
      };
    case "MISSING":
    case "COMPLETED":
      return {
        title: "この履歴にはフォーム計測の結果がありません",
        description:
          "AI分析はそのまま確認できます。新しい動画では端末内のフォーム計測も記録されます。",
      };
  }
}

export function PoseMeasurementCard({
  state,
}: {
  state: PoseHistoryComparisonState;
}) {
  if (state.kind === "unassessable") {
    const copy = unassessableCopy(state.status);

    return (
      <Card className="border-warning/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TriangleAlertIcon
              aria-hidden="true"
              className="size-5 text-warning"
            />
            フォーム計測
          </CardTitle>
          <CardDescription>
            フォームの数値は表示できませんが、AI分析は独立して進みます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
            <p className="font-medium text-foreground">{copy.title}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {copy.description}
            </p>
          </div>
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Link
              href="#ai-analysis"
              className={cn(buttonVariants({ size: "lg" }), "h-11")}
            >
              AI分析を見る
              <ArrowRightIcon aria-hidden="true" />
            </Link>
            <Link
              href="/videos/new"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-11",
              )}
            >
              <VideoIcon aria-hidden="true" />
              別の動画で撮り直す（任意）
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>フォーム計測</CardTitle>
        <CardDescription>
          端末内で計測した動きの記録です。数値や変化は成功・失敗を判定するものではありません。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.kind === "comparison" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <span className="text-muted-foreground">
                同じ撮影・処理条件の前回
              </span>
              <Link
                href={`/history/${state.previous.sessionId}`}
                className="font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {comparisonDateFormatter.format(state.previous.practicedAt)}
              </Link>
            </div>
            <ComparisonMetrics state={state} />
          </>
        ) : (
          <>
            <CurrentMetricValues metrics={state.current} />
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <p className="font-medium">次回比較の基準値</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {baselineReason(state).reason}
                今回の値を、条件が揃う次回の比較基準として記録します。
              </p>
              {baselineReason(state).guidance ? (
                <p className="mt-2 text-sm leading-6">
                  {baselineReason(state).guidance}
                </p>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
