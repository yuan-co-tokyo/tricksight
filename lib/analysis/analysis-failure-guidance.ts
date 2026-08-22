import {
  formatAnalysisResetAt,
  type AnalysisRequestErrorDetail,
} from "./analysis-client";

export type AnalysisFailureGuidance = {
  kind: "retry" | "profile" | "wait" | "record" | "sign-in";
  title: string;
  description: string;
};

export function getAnalysisFailureGuidance(
  error: AnalysisRequestErrorDetail,
): AnalysisFailureGuidance {
  switch (error.action) {
    case "RETRY_ANALYSIS":
      return {
        kind: "retry",
        title: "もう一度分析できます",
        description: error.message,
      };
    case "SET_STANCE":
      return {
        kind: "profile",
        title: "スタンスの設定が必要です",
        description: error.message,
      };
    case "WAIT_FOR_RESET": {
      const resetAt = formatAnalysisResetAt(error.resetAt);
      return {
        kind: "wait",
        title: "本日の分析回数に達しました",
        description: resetAt
          ? `${error.message} ${resetAt}以降に再開できます。`
          : error.message,
      };
    }
    case "RECORD_AGAIN":
    case "SELECT_VIDEO":
    case "WAIT_FOR_UPLOAD":
    case "CHECK_INPUT":
      return {
        kind: "record",
        title: "動画を登録し直してください",
        description: error.message,
      };
    case "SIGN_IN":
      return {
        kind: "sign-in",
        title: "ログインが必要です",
        description: error.message,
      };
    case "TRY_LATER":
      return {
        kind: "retry",
        title: "時間をおいて再分析できます",
        description: error.message,
      };
  }
}
