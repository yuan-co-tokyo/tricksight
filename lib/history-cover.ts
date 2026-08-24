export type HistoryCoverVideoStatus =
  | "PENDING_UPLOAD"
  | "UPLOADED"
  | "READY"
  | "FAILED"
  | null;

const coverStatusLabels = {
  PENDING_UPLOAD: "アップロード確認中",
  UPLOADED: "分析受付済み",
  READY: "練習動画",
  FAILED: "練習記録",
} as const;

export function getHistoryCoverPresentation(input: {
  trickName: string;
  videoStatus: HistoryCoverVideoStatus;
}) {
  const statusLabel = input.videoStatus
    ? coverStatusLabels[input.videoStatus]
    : "練習記録";

  return {
    eyebrow: "TRICK PRACTICE",
    statusLabel,
    accessibleLabel: `${input.trickName}の${statusLabel}カバー`,
  };
}
