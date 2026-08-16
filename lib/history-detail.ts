import {
  skateAnalysisResultSchema,
  type SkateAnalysisResult,
} from "./analysis/schema";

type AnalysisForDisplay = {
  status: "QUEUED" | "ANALYZING" | "COMPLETED" | "FAILED";
  resultJson: unknown;
} | null;

export function getCompletedAnalysisResult(
  analysis: AnalysisForDisplay,
): SkateAnalysisResult | null {
  if (analysis?.status !== "COMPLETED") return null;

  const parsed = skateAnalysisResultSchema.safeParse(analysis.resultJson);

  if (!parsed.success) return null;

  return {
    ...parsed.data,
    improvements: [...parsed.data.improvements].sort(
      (left, right) => left.priority - right.priority,
    ),
  };
}

export function formatTimestampSeconds(timestampSeconds: number) {
  if (timestampSeconds < 60) {
    return `${timestampSeconds.toFixed(1).replace(/\.0$/, "")}秒`;
  }

  const minutes = Math.floor(timestampSeconds / 60);
  const seconds = (timestampSeconds % 60).toFixed(1).replace(/\.0$/, "");

  return `${minutes}分${seconds}秒`;
}
