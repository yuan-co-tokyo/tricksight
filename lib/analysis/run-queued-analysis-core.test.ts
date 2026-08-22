import { describe, expect, it, vi } from "vitest";

import { VideoAnalysisError, type VideoAnalysisProvider } from "./provider";
import type { SkateAnalysisResult } from "./schema";
import {
  createRunQueuedAnalysis,
  type ClaimedAnalysis,
  type QueuedAnalysisExecutionContext,
  type QueuedAnalysisExecutionStore,
} from "./run-queued-analysis-core";

const analysisId = "00000000-0000-4000-8000-000000000001";
const startedAt = new Date("2026-08-17T02:00:00.000Z");
const completedAt = new Date("2026-08-17T02:00:05.000Z");

const claimedAnalysis = {
  id: analysisId,
  provider: "twelvelabs",
  modelId: "pegasus1.5",
  promptVersion: "common-system-v2+kickflip-v1",
} satisfies ClaimedAnalysis;

const context = {
  videoS3Key: "private/user/session/video/original.mp4",
  videoStatus: "UPLOADED",
  trickSlug: "kickflip",
  stance: "REGULAR",
  cameraAngle: "SIDE",
} satisfies QueuedAnalysisExecutionContext;

const analysisResult: SkateAnalysisResult = {
  summary: "安定したセットアップです。",
  detected: { trickMatchesSelection: true, visibility: "GOOD" },
  result: { outcome: "LANDED", confidence: 0.9 },
  scores: {
    setup: 80,
    pop: 75,
    bodyBalance: 70,
    footControl: 78,
    landing: 82,
  },
  strengths: [{ title: "安定", description: "姿勢が安定しています。" }],
  improvements: [
    {
      title: "タイミング",
      description: "前足を少し早く動かします。",
      priority: 1,
    },
  ],
  nextPractice: { focus: "前足", drill: "ゆっくり10回練習します。" },
};

function setup(options: {
  claimed?: ClaimedAnalysis | null;
  context?: QueuedAnalysisExecutionContext | null;
  analyzeError?: unknown;
  outputPromptVersion?: string;
} = {}) {
  const claimQueuedAnalysis = vi.fn().mockResolvedValue(
    options.claimed === undefined ? claimedAnalysis : options.claimed,
  );
  const loadExecutionContext = vi.fn().mockResolvedValue(
    options.context === undefined ? context : options.context,
  );
  const completeAnalysis = vi.fn().mockResolvedValue(true);
  const failAnalysis = vi.fn().mockResolvedValue(true);
  const store: QueuedAnalysisExecutionStore = {
    claimQueuedAnalysis,
    loadExecutionContext,
    completeAnalysis,
    failAnalysis,
  };
  const analyze = vi.fn(async () => {
    if (options.analyzeError !== undefined) throw options.analyzeError;
    return {
      result: analysisResult,
      rawResponse: { providerPayload: "db-only" },
      promptVersion:
        options.outputPromptVersion ??
        "common-system-v2+kickflip-v1",
    };
  });
  const provider: VideoAnalysisProvider = {
    providerName: "twelvelabs",
    modelId: "pegasus1.5",
    analyze,
  };
  const createProvider = vi.fn(() => provider);
  const timestamps = [startedAt, completedAt];
  const runner = createRunQueuedAnalysis({
    store,
    createProvider,
    resolvePrompt: vi.fn(() => ({
      trick: "kickflip" as const,
      family: "v2",
      version: "common-system-v2+kickflip-v1",
    })),
    createVideoS3Uri: vi.fn(
      (s3Key) => `s3://private-bucket/${s3Key}`,
    ),
    now: () => timestamps.shift() ?? completedAt,
  });

  return {
    analyze,
    claimQueuedAnalysis,
    completeAnalysis,
    createProvider,
    failAnalysis,
    loadExecutionContext,
    runner,
  };
}

describe("run queued analysis", () => {
  it("does not call the provider when the conditional claim updates zero rows", async () => {
    const {
      analyze,
      completeAnalysis,
      createProvider,
      failAnalysis,
      loadExecutionContext,
      runner,
    } = setup({ claimed: null });

    await expect(runner(analysisId)).resolves.toEqual({
      outcome: "NOT_CLAIMED",
      analysisId,
    });
    expect(loadExecutionContext).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
    expect(completeAnalysis).not.toHaveBeenCalled();
    expect(failAnalysis).not.toHaveBeenCalled();
  });

  it("records the structured and raw response after a successful analysis", async () => {
    const { analyze, claimQueuedAnalysis, completeAnalysis, failAnalysis, runner } =
      setup();

    await expect(runner(analysisId)).resolves.toEqual({
      outcome: "COMPLETED",
      analysisId,
    });
    expect(claimQueuedAnalysis).toHaveBeenCalledWith({
      analysisId,
      startedAt,
    });
    expect(analyze).toHaveBeenCalledWith({
      videoS3Uri:
        "s3://private-bucket/private/user/session/video/original.mp4",
      trick: "kickflip",
      stance: "REGULAR",
      cameraAngle: "SIDE",
      promptVersion: "v2",
    });
    expect(completeAnalysis).toHaveBeenCalledWith({
      analysisId,
      resultJson: analysisResult,
      rawResponse: { providerPayload: "db-only" },
      promptVersion: "common-system-v2+kickflip-v1",
      completedAt,
    });
    expect(failAnalysis).not.toHaveBeenCalled();
  });

  it("records VideoAnalysisError code and details on failure", async () => {
    const providerError = new VideoAnalysisError(
      "PROVIDER_FAILED",
      "client-safe summary",
      { details: "sanitized provider details" },
    );
    const { completeAnalysis, failAnalysis, runner } = setup({
      analyzeError: providerError,
    });

    await expect(runner(analysisId)).resolves.toEqual({
      outcome: "FAILED",
      analysisId,
      errorCode: "PROVIDER_FAILED",
    });
    expect(failAnalysis).toHaveBeenCalledWith({
      analysisId,
      errorCode: "PROVIDER_FAILED",
      errorMessage: "sanitized provider details",
      completedAt,
    });
    expect(completeAnalysis).not.toHaveBeenCalled();
  });

  it("redacts secrets from explicit provider details before persistence", async () => {
    const providerError = new VideoAnalysisError(
      "ANALYZE_FAILED",
      "provider failed",
      {
        details:
          "api_key=tlk_super-secret-value authorization: Bearer bearer-secret",
      },
    );
    const { failAnalysis, runner } = setup({ analyzeError: providerError });

    await expect(runner(analysisId)).resolves.toMatchObject({
      outcome: "FAILED",
      errorCode: "ANALYZE_FAILED",
    });
    const persistedMessage = failAnalysis.mock.calls[0]?.[0].errorMessage;
    expect(persistedMessage).toContain("[REDACTED]");
    expect(persistedMessage).not.toContain("tlk_super-secret-value");
    expect(persistedMessage).not.toContain("bearer-secret");
  });

  it("does not guess a stance or call the provider when stance is null", async () => {
    const { analyze, createProvider, failAnalysis, runner } = setup({
      context: { ...context, stance: null },
    });

    await expect(runner(analysisId)).resolves.toEqual({
      outcome: "FAILED",
      analysisId,
      errorCode: "STANCE_REQUIRED",
    });
    expect(createProvider).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
    expect(failAnalysis).toHaveBeenCalledWith({
      analysisId,
      errorCode: "STANCE_REQUIRED",
      errorMessage: "分析前にプロフィールでスタンスを設定してください。",
      completedAt,
    });
  });

  it("fails instead of recording a mismatched provider prompt version", async () => {
    const { completeAnalysis, failAnalysis, runner } = setup({
      outputPromptVersion: "common-system-v2+kickflip-v2",
    });

    await expect(runner(analysisId)).resolves.toMatchObject({
      outcome: "FAILED",
      errorCode: "PROMPT_VERSION_MISMATCH",
    });
    expect(completeAnalysis).not.toHaveBeenCalled();
    expect(failAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "PROMPT_VERSION_MISMATCH",
      }),
    );
  });
});
