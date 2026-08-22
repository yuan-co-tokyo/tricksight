import type { SkateAnalysisResult } from "./schema";
import { SLOW_MOTION_VIDEO_GUIDANCE } from "../uploads/slow-motion-guidance";

type AnalysisVisibility = SkateAnalysisResult["detected"]["visibility"];

export type VisibilityGuidance = {
  title: string;
  resultContext: string;
  requirement: string;
  explanation: string;
};

export function getVisibilityGuidance(
  visibility: AnalysisVisibility,
): VisibilityGuidance | null {
  if (visibility === "GOOD") return null;

  return {
    title:
      visibility === "POOR"
        ? "動きを十分に確認できませんでした"
        : "一部の動きを確認しづらい場面がありました",
    resultContext:
      visibility === "POOR"
        ? "分析は完了していますが、映像から読み取れる情報が少なく、結果の精度が低い可能性があります。結果は参考として確認してください。"
        : "分析は完了していますが、一部の動きが見えにくく、結果の精度に影響している可能性があります。",
    requirement: SLOW_MOTION_VIDEO_GUIDANCE.requirement,
    explanation: SLOW_MOTION_VIDEO_GUIDANCE.explanation,
  };
}
