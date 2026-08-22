"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock3Icon,
  LogInIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  UserRoundCogIcon,
  VideoIcon,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  AnalysisRequestError,
  requestAnalysisStart,
  type AnalysisRequestErrorDetail,
  type AnalysisStartResponse,
} from "@/lib/analysis/analysis-client";
import { getAnalysisFailureGuidance } from "@/lib/analysis/analysis-failure-guidance";
import type { PublicAnalysisError } from "@/lib/analysis/analysis-public-error";
import { cn } from "@/lib/utils";

import { AnalysisProgress } from "./analysis-progress";

const fallbackRetryError: AnalysisRequestErrorDetail = {
  code: "ANALYSIS_UNAVAILABLE",
  message:
    "現在、分析を利用できません。時間をおいてからもう一度お試しください。",
  action: "TRY_LATER",
};

function LinkAction({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        buttonVariants({ variant: "default", size: "lg" }),
        "h-11 w-full",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

export function AnalysisFailureActions({
  videoId,
  initialError,
}: {
  videoId: string | null;
  initialError: PublicAnalysisError;
}) {
  const router = useRouter();
  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] =
    useState<AnalysisRequestErrorDetail>(initialError);
  const [startedAnalysis, setStartedAnalysis] =
    useState<AnalysisStartResponse | null>(null);
  const guidance = getAnalysisFailureGuidance(error);

  async function handleRetry() {
    if (!videoId || submittingRef.current) return;

    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      const started = await requestAnalysisStart(videoId);
      setStartedAnalysis(started);
      router.refresh();
    } catch (reason) {
      setError(
        reason instanceof AnalysisRequestError
          ? reason.detail
          : fallbackRetryError,
      );
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  if (startedAnalysis) {
    return (
      <AnalysisProgress
        analysisId={startedAnalysis.analysisId}
        initialStatus={startedAnalysis.status}
      />
    );
  }

  return (
    <div
      aria-live="polite"
      className="overflow-hidden rounded-xl border border-error/30 bg-error/5"
    >
      <div className="flex min-w-0 items-start gap-3 p-4 sm:p-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-error/15 text-error">
          <TriangleAlertIcon aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-foreground">分析を完了できませんでした</p>
          <p className="mt-1 text-sm font-medium text-error">
            {guidance.title}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {guidance.description}
          </p>
        </div>
      </div>

      <div className="border-t border-error/20 p-4 sm:p-5">
        {!videoId ? (
          <LinkAction
            href="/videos/new"
            icon={<VideoIcon aria-hidden="true" />}
          >
            新しい動画を登録
          </LinkAction>
        ) : guidance.kind === "retry" ? (
          <Button
            type="button"
            size="lg"
            className="h-11 w-full"
            onClick={handleRetry}
            disabled={isSubmitting}
          >
            <RefreshCwIcon
              aria-hidden="true"
              className={cn(isSubmitting && "animate-spin")}
            />
            {isSubmitting ? "再分析を受け付けています…" : "もう一度分析する"}
          </Button>
        ) : guidance.kind === "profile" ? (
          <LinkAction
            href="/profile"
            icon={<UserRoundCogIcon aria-hidden="true" />}
          >
            プロフィールでスタンスを設定
          </LinkAction>
        ) : guidance.kind === "record" ? (
          <LinkAction
            href="/videos/new"
            icon={<VideoIcon aria-hidden="true" />}
          >
            新しい動画を登録
          </LinkAction>
        ) : guidance.kind === "sign-in" ? (
          <LinkAction href="/login" icon={<LogInIcon aria-hidden="true" />}>
            ログインする
          </LinkAction>
        ) : (
          <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
            <Clock3Icon aria-hidden="true" className="mt-1 size-4 shrink-0" />
            リセット時刻になるまでお待ちください。
          </p>
        )}
      </div>
    </div>
  );
}
