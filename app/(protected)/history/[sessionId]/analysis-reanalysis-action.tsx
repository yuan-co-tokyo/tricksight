"use client";

import { useState } from "react";

import type {
  AnalysisRequestErrorDetail,
  AnalysisStartResponse,
} from "@/lib/analysis/analysis-client";

import { AnalysisFailureActions } from "./analysis-failure-actions";
import { AnalysisProgress } from "./analysis-progress";
import { AnalysisStartButton } from "./analysis-start-button";

export function AnalysisReanalysisAction({ videoId }: { videoId: string }) {
  const [requestError, setRequestError] =
    useState<AnalysisRequestErrorDetail | null>(null);
  const [startedAnalysis, setStartedAnalysis] =
    useState<AnalysisStartResponse | null>(null);

  if (startedAnalysis) {
    return (
      <AnalysisProgress
        analysisId={startedAnalysis.analysisId}
        initialStatus={startedAnalysis.status}
      />
    );
  }

  if (requestError) {
    return (
      <AnalysisFailureActions
        videoId={videoId}
        initialError={requestError}
        heading="再分析を開始できませんでした"
      />
    );
  }

  return (
    <section
      aria-labelledby="reanalysis-heading"
      className="border-t border-border pt-5"
    >
      <h3 id="reanalysis-heading" className="font-semibold">
        もう一度分析する
      </h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        同じ動画を使って、新しい分析を開始できます。
      </p>
      <div className="mt-3">
        <AnalysisStartButton
          videoId={videoId}
          idleLabel="この動画を再分析する"
          onStarted={setStartedAnalysis}
          onError={setRequestError}
        />
      </div>
    </section>
  );
}
