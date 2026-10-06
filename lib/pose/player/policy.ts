export type SavedPoseStatus = "COMPLETED" | "UNASSESSABLE" | "FAILED" | "TIMED_OUT" | "CANCELED" | "MISSING";
export type ViewerEnvironment = {
  POSE_VIEWER_ENABLED?: string;
  POSE_VIEWER_AUDIENCE?: string;
  POSE_VIEWER_USER_IDS?: string;
};
// Called only by the authenticated, owner-scoped Server Component.
export function canUsePoseViewer(env: ViewerEnvironment, userId: string) {
  if (env.POSE_VIEWER_ENABLED !== "true" || !userId) return false;
  if (env.POSE_VIEWER_AUDIENCE === "all") return true;
  if (env.POSE_VIEWER_AUDIENCE !== undefined && env.POSE_VIEWER_AUDIENCE !== "allowlist") return false;
  return (env.POSE_VIEWER_USER_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean).includes(userId);
}
export function viewerOffer(playable: boolean, status: SavedPoseStatus) {
  return { available: playable, label: status === "UNASSESSABLE" ? "検出できた部分を見る" : "骨格と数値を表示" };
}
export type ViewerState = "OFF" | "FETCHING" | "READY_TO_START" | "MEASURING" | "READY" | "PARTIAL" | "ERROR" | "STOPPED" | "BACKGROUND";
export const viewerMessages: Record<ViewerState, string> = {
  OFF: "必要なときだけ、この端末で表示用に計測できます。",
  FETCHING: "表示用の動画を取得しています…",
  READY_TO_START: "動画を取得しました。「計測を開始」を押してください。",
  MEASURING: "骨格と数値を準備しています…",
  READY: "この端末で今回表示用に計測しました。",
  PARTIAL: "十分に検出できなかったため、骨格だけを表示します。数値は表示できません。",
  ERROR: "この端末では骨格表示を準備できませんでした。通常の動画はそのまま見られます。ページを再読み込みしてお試しください。",
  STOPPED: "表示を終了しました。もう一度表示するには動画の取得から始めてください。",
  BACKGROUND: "別の画面へ移ったため、骨格の表示を終了しました。もう一度表示するには動画の取得から始めてください。",
};
