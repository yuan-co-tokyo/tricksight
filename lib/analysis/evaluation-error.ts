import {
  formatVideoAnalysisErrorDetails,
  sanitizeVideoAnalysisErrorText,
  VideoAnalysisError,
} from "./provider";

export type FormattedEvaluationError = {
  message: string;
  details: string;
};

export function formatEvaluationError(
  error: unknown,
): FormattedEvaluationError {
  if (error instanceof VideoAnalysisError) {
    return {
      message: `${error.name}: ${sanitizeVideoAnalysisErrorText(error.message)}`,
      // detailsだけでなくrawResponseも含め、モデル出力の崩れを再実行なしで
      // 切り分けられるようにする。共通formatter内で秘密値はマスクされる。
      details: formatVideoAnalysisErrorDetails(error),
    };
  }

  if (error instanceof Error) {
    return {
      message: `${error.name}: ${sanitizeVideoAnalysisErrorText(error.message)}`,
      details: formatVideoAnalysisErrorDetails(error),
    };
  }

  return {
    message: sanitizeVideoAnalysisErrorText(String(error)),
    details: formatVideoAnalysisErrorDetails(error),
  };
}
