import {
  formatVideoAnalysisErrorDetails,
  VideoAnalysisError,
  type CameraAngle,
  type Stance,
  type VideoAnalysisInput,
  type VideoAnalysisProvider,
} from "./provider";
import type { SkateAnalysisResult } from "./schema";

export type ClaimedAnalysis = {
  id: string;
  provider: string;
  modelId: string;
  promptVersion: string;
};

export type QueuedAnalysisExecutionContext = {
  videoS3Key: string;
  videoStatus: "PENDING_UPLOAD" | "UPLOADED" | "READY" | "FAILED";
  trickSlug: string;
  stance: Stance | null;
  cameraAngle: CameraAngle;
};

export type ResolvedQueuedAnalysisPrompt = {
  trick: VideoAnalysisInput["trick"];
  family: string;
  version: string;
};

export interface QueuedAnalysisExecutionStore {
  claimQueuedAnalysis(input: {
    analysisId: string;
    startedAt: Date;
  }): Promise<ClaimedAnalysis | null>;
  loadExecutionContext(
    analysisId: string,
  ): Promise<QueuedAnalysisExecutionContext | null>;
  completeAnalysis(input: {
    analysisId: string;
    resultJson: SkateAnalysisResult;
    rawResponse: unknown;
    promptVersion: string;
    completedAt: Date;
  }): Promise<boolean>;
  failAnalysis(input: {
    analysisId: string;
    errorCode: string;
    errorMessage: string;
    completedAt: Date;
  }): Promise<boolean>;
}

export type RunQueuedAnalysisDependencies = {
  store: QueuedAnalysisExecutionStore;
  createProvider(): VideoAnalysisProvider;
  resolvePrompt(trickSlug: string): ResolvedQueuedAnalysisPrompt;
  createVideoS3Uri(s3Key: string): string;
  now(): Date;
};

export type RunQueuedAnalysisResult =
  | { outcome: "NOT_CLAIMED"; analysisId: string }
  | { outcome: "COMPLETED"; analysisId: string }
  | {
      outcome: "FAILED";
      analysisId: string;
      errorCode: string;
    };

function asFailure(cause: unknown) {
  if (cause instanceof VideoAnalysisError) {
    return {
      errorCode: cause.code,
      errorMessage: cause.details ?? cause.message,
    };
  }

  return {
    errorCode: "ANALYSIS_FAILED",
    errorMessage: formatVideoAnalysisErrorDetails(cause),
  };
}

function requireExecutionContext(
  context: QueuedAnalysisExecutionContext | null,
): asserts context is QueuedAnalysisExecutionContext & { stance: Stance } {
  if (!context) {
    throw new VideoAnalysisError(
      "ANALYSIS_CONTEXT_NOT_FOUND",
      "分析対象の動画情報を取得できませんでした。",
    );
  }

  if (context.stance === null) {
    // 足の役割を逆に解釈しないよう、REGULAR等の既定値は推測しない。
    throw new VideoAnalysisError(
      "STANCE_REQUIRED",
      "分析前にプロフィールでスタンスを設定してください。",
    );
  }

  if (
    context.videoStatus !== "UPLOADED" &&
    context.videoStatus !== "READY"
  ) {
    throw new VideoAnalysisError(
      "VIDEO_NOT_READY",
      "動画が分析可能な状態ではありません。",
    );
  }
}

export function createRunQueuedAnalysis(
  dependencies: RunQueuedAnalysisDependencies,
) {
  return async function runQueuedAnalysis(
    analysisId: string,
  ): Promise<RunQueuedAnalysisResult> {
    const claimed = await dependencies.store.claimQueuedAnalysis({
      analysisId,
      startedAt: dependencies.now(),
    });

    // 条件付きUPDATEが0件なら、別ワーカーが取得済みなので課金処理へ進まない。
    if (!claimed) return { outcome: "NOT_CLAIMED", analysisId };

    try {
      const context = await dependencies.store.loadExecutionContext(
        analysisId,
      );
      requireExecutionContext(context);

      let resolvedPrompt: ResolvedQueuedAnalysisPrompt;
      try {
        resolvedPrompt = dependencies.resolvePrompt(context.trickSlug);
      } catch (cause) {
        throw new VideoAnalysisError(
          "PROMPT_UNAVAILABLE",
          "分析対象のトリックに対応するプロンプトを解決できませんでした。",
          { cause },
        );
      }

      if (resolvedPrompt.version !== claimed.promptVersion) {
        throw new VideoAnalysisError(
          "PROMPT_VERSION_MISMATCH",
          "キュー作成時のプロンプトバージョンと実行時のバージョンが一致しません。",
        );
      }

      const provider = dependencies.createProvider();
      if (
        provider.providerName !== claimed.provider ||
        provider.modelId !== claimed.modelId
      ) {
        throw new VideoAnalysisError(
          "PROVIDER_CONFIG_MISMATCH",
          "キュー作成時のAIプロバイダー設定と実行時の設定が一致しません。",
        );
      }

      const output = await provider.analyze({
        videoS3Uri: dependencies.createVideoS3Uri(context.videoS3Key),
        trick: resolvedPrompt.trick,
        stance: context.stance,
        cameraAngle: context.cameraAngle,
        promptVersion: resolvedPrompt.family,
      });

      if (output.promptVersion !== claimed.promptVersion) {
        throw new VideoAnalysisError(
          "PROMPT_VERSION_MISMATCH",
          "AIプロバイダーが使用したプロンプトバージョンがキューの記録と一致しません。",
        );
      }

      const completed = await dependencies.store.completeAnalysis({
        analysisId,
        resultJson: output.result,
        rawResponse: output.rawResponse,
        promptVersion: output.promptVersion,
        completedAt: dependencies.now(),
      });

      if (!completed) {
        throw new Error(
          "The claimed analysis could not be transitioned to COMPLETED.",
        );
      }

      return { outcome: "COMPLETED", analysisId };
    } catch (cause) {
      const failure = asFailure(cause);
      const failed = await dependencies.store.failAnalysis({
        analysisId,
        ...failure,
        completedAt: dependencies.now(),
      });

      if (!failed) {
        throw new Error(
          "The claimed analysis could not be transitioned to FAILED.",
          { cause },
        );
      }

      return {
        outcome: "FAILED",
        analysisId,
        errorCode: failure.errorCode,
      };
    }
  };
}
