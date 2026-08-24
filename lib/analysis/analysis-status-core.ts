import {
  publicAnalysisFailure,
  type PublicAnalysisError,
} from "./analysis-public-error";

export const STUCK_ANALYSIS_THRESHOLD_MS = 10 * 60 * 1_000;
export const STUCK_ANALYSIS_ERROR_CODE = "ANALYSIS_STUCK_TIMEOUT";

export type AnalysisStatus =
  | "QUEUED"
  | "ANALYZING"
  | "COMPLETED"
  | "FAILED";

export type OwnedAnalysisStatusRecord = {
  id: string;
  status: AnalysisStatus;
  startedAt: Date | null;
  errorCode: string | null;
};

export type AnalysisStatusResult = {
  analysisId: string;
  status: AnalysisStatus;
  error: PublicAnalysisError | null;
};

export interface AnalysisStatusStore {
  findOwnedAnalysis(input: {
    userId: string;
    analysisId: string;
  }): Promise<OwnedAnalysisStatusRecord | null>;
  failOwnedStuckAnalysis(input: {
    userId: string;
    analysisId: string;
    startedBefore: Date;
    completedAt: Date;
    errorCode: typeof STUCK_ANALYSIS_ERROR_CODE;
    errorMessage: string;
  }): Promise<OwnedAnalysisStatusRecord | null>;
}

type Dependencies = {
  store: AnalysisStatusStore;
  now(): Date;
  stuckThresholdMs?: number;
  reportStuckAnalysis?(input: {
    analysisId: string;
    errorCode: typeof STUCK_ANALYSIS_ERROR_CODE;
  }): void;
};

function publicStatus(
  record: OwnedAnalysisStatusRecord,
): AnalysisStatusResult {
  return {
    analysisId: record.id,
    status: record.status,
    // DBのerror_code/error_messageは内部診断専用。公開コードへ必ず変換する。
    error:
      record.status === "FAILED"
        ? publicAnalysisFailure(record.errorCode)
        : null,
  };
}

export function createOwnedAnalysisStatusReader(dependencies: Dependencies) {
  const stuckThresholdMs =
    dependencies.stuckThresholdMs ?? STUCK_ANALYSIS_THRESHOLD_MS;

  return async function getOwnedAnalysisStatus(input: {
    userId: string;
    analysisId: string;
  }): Promise<AnalysisStatusResult | null> {
    const current = await dependencies.store.findOwnedAnalysis(input);

    if (!current) return null;

    const now = dependencies.now();
    const startedBefore = new Date(now.getTime() - stuckThresholdMs);
    const isStuck =
      current.status === "ANALYZING" &&
      current.startedAt !== null &&
      current.startedAt < startedBefore;

    if (!isStuck) return publicStatus(current);

    const failed = await dependencies.store.failOwnedStuckAnalysis({
      ...input,
      startedBefore,
      completedAt: now,
      errorCode: STUCK_ANALYSIS_ERROR_CODE,
      errorMessage:
        "分析ワーカーが制限時間内に完了しなかったため、スタック検出により失敗扱いにしました。",
    });

    if (failed) {
      dependencies.reportStuckAnalysis?.({
        analysisId: failed.id,
        errorCode: STUCK_ANALYSIS_ERROR_CODE,
      });
      return publicStatus(failed);
    }

    // 別pollまたはworkerが先に状態遷移した場合は、その確定済み状態を返す。
    const concurrent = await dependencies.store.findOwnedAnalysis(input);
    return concurrent ? publicStatus(concurrent) : null;
  };
}
