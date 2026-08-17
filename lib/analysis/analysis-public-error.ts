export type AnalysisErrorAction =
  | "CHECK_INPUT"
  | "SIGN_IN"
  | "SELECT_VIDEO"
  | "WAIT_FOR_UPLOAD"
  | "SET_STANCE"
  | "RETRY_ANALYSIS"
  | "RECORD_AGAIN"
  | "TRY_LATER"
  | "WAIT_FOR_RESET";

export type PublicAnalysisError = {
  code: string;
  message: string;
  action: AnalysisErrorAction;
};

export const ANALYSIS_REQUEST_ERRORS = {
  INVALID_REQUEST: {
    code: "INVALID_REQUEST",
    message: "リクエスト内容を確認して、もう一度お試しください。",
    action: "CHECK_INPUT",
  },
  UNAUTHENTICATED: {
    code: "UNAUTHENTICATED",
    message: "ログインしてから、もう一度お試しください。",
    action: "SIGN_IN",
  },
  VIDEO_NOT_FOUND: {
    code: "VIDEO_NOT_FOUND",
    message: "対象の動画が見つかりません。自分の動画を選び直してください。",
    action: "SELECT_VIDEO",
  },
  VIDEO_NOT_READY: {
    code: "VIDEO_NOT_READY",
    message: "動画の準備が完了していません。アップロード完了後にもう一度お試しください。",
    action: "WAIT_FOR_UPLOAD",
  },
  STANCE_REQUIRED: {
    code: "STANCE_REQUIRED",
    message: "プロフィールでスタンスを設定してから、もう一度分析してください。",
    action: "SET_STANCE",
  },
  ANALYSIS_STATE_CHANGED: {
    code: "ANALYSIS_STATE_CHANGED",
    message: "分析状態が更新されました。最新の状態を確認してから、もう一度お試しください。",
    action: "RETRY_ANALYSIS",
  },
  ANALYSIS_UNAVAILABLE: {
    code: "ANALYSIS_UNAVAILABLE",
    message: "現在、分析を利用できません。時間をおいてからもう一度お試しください。",
    action: "TRY_LATER",
  },
  ANALYSIS_NOT_FOUND: {
    code: "ANALYSIS_NOT_FOUND",
    message: "対象の分析が見つかりません。履歴から分析を選び直してください。",
    action: "SELECT_VIDEO",
  },
} as const satisfies Record<string, PublicAnalysisError>;

const RETRYABLE_INTERNAL_CODES = new Set([
  "ANALYSIS_STUCK_TIMEOUT",
  "ASSET_TIMEOUT",
  "ASSET_CREATE_FAILED",
  "ANALYZE_FAILED",
  "OUTPUT_TRUNCATED",
  "INVALID_JSON",
  "SCHEMA_VALIDATION_FAILED",
]);

const RECORD_AGAIN_INTERNAL_CODES = new Set([
  "ANALYSIS_CONTEXT_NOT_FOUND",
  "VIDEO_NOT_READY",
  "ASSET_FAILED",
]);

export function publicAnalysisFailure(
  internalCode: string | null,
): PublicAnalysisError {
  if (internalCode === "STANCE_REQUIRED") {
    return {
      code: "STANCE_REQUIRED",
      message: "プロフィールでスタンスを設定してから、再分析してください。",
      action: "SET_STANCE",
    };
  }

  if (internalCode && RECORD_AGAIN_INTERNAL_CODES.has(internalCode)) {
    return {
      code: "VIDEO_REUPLOAD_REQUIRED",
      message: "動画を処理できませんでした。撮影し直してアップロードしてから、再分析してください。",
      action: "RECORD_AGAIN",
    };
  }

  if (internalCode && RETRYABLE_INTERNAL_CODES.has(internalCode)) {
    return {
      code: "ANALYSIS_RETRYABLE",
      message: "分析を完了できませんでした。少し時間をおいてから再分析してください。",
      action: "RETRY_ANALYSIS",
    };
  }

  return {
    code: "ANALYSIS_UNAVAILABLE",
    message: "現在、分析を完了できません。時間をおいてからもう一度お試しください。",
    action: "TRY_LATER",
  };
}
