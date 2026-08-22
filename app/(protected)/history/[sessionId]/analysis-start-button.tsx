"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AnalysisRequestError,
  requestAnalysisStart,
  type AnalysisRequestErrorDetail,
  type AnalysisStartResponse,
} from "@/lib/analysis/analysis-client";
import { cn } from "@/lib/utils";

const fallbackRequestError: AnalysisRequestErrorDetail = {
  code: "ANALYSIS_UNAVAILABLE",
  message:
    "現在、分析を利用できません。時間をおいてからもう一度お試しください。",
  action: "TRY_LATER",
};

export function AnalysisStartButton({
  videoId,
  idleLabel = "もう一度分析する",
  pendingLabel = "再分析を受け付けています…",
  onStarted,
  onError,
}: {
  videoId: string;
  idleLabel?: string;
  pendingLabel?: string;
  onStarted(result: AnalysisStartResponse): void;
  onError(error: AnalysisRequestErrorDetail): void;
}) {
  const router = useRouter();
  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleStart() {
    if (submittingRef.current) return;

    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      const started = await requestAnalysisStart(videoId);
      onStarted(started);
      router.refresh();
    } catch (reason) {
      onError(
        reason instanceof AnalysisRequestError
          ? reason.detail
          : fallbackRequestError,
      );
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <Button
      type="button"
      size="lg"
      className="h-11 w-full"
      onClick={handleStart}
      disabled={isSubmitting}
    >
      <RefreshCwIcon
        aria-hidden="true"
        className={cn(isSubmitting && "animate-spin")}
      />
      {isSubmitting ? pendingLabel : idleLabel}
    </Button>
  );
}
