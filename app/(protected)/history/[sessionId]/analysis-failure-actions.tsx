"use client";

import { type ReactNode, useState } from "react";
import Link from "next/link";
import {
  Clock3Icon,
  LogInIcon,
  TriangleAlertIcon,
  UserRoundCogIcon,
  VideoIcon,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import type {
  AnalysisRequestErrorDetail,
  AnalysisStartResponse,
} from "@/lib/analysis/analysis-client";
import { getAnalysisFailureGuidance } from "@/lib/analysis/analysis-failure-guidance";
import type { PublicAnalysisError } from "@/lib/analysis/analysis-public-error";
import { cn } from "@/lib/utils";

import { AnalysisProgress } from "./analysis-progress";
import { AnalysisStartButton } from "./analysis-start-button";

function LinkAction({
  href,
  icon,
  children,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
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
  heading = "分析を完了できませんでした",
}: {
  videoId: string | null;
  initialError: PublicAnalysisError;
  heading?: string;
}) {
  const [error, setError] =
    useState<AnalysisRequestErrorDetail>(initialError);
  const [startedAnalysis, setStartedAnalysis] =
    useState<AnalysisStartResponse | null>(null);
  const guidance = getAnalysisFailureGuidance(error);

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
          <p className="font-semibold text-foreground">{heading}</p>
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
          <AnalysisStartButton
            videoId={videoId}
            onStarted={setStartedAnalysis}
            onError={setError}
          />
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
