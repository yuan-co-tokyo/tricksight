import { describe, expect, it } from "vitest";

import { publicAnalysisFailure } from "./analysis-public-error";
import { getAnalysisFailureGuidance } from "./analysis-failure-guidance";

describe("analysis failure guidance", () => {
  it("offers reanalysis for retryable and temporary failures", () => {
    expect(
      getAnalysisFailureGuidance({
        code: "ANALYSIS_RETRYABLE",
        message: "少し時間をおいてから再分析してください。",
        action: "RETRY_ANALYSIS",
      }),
    ).toEqual({
      kind: "retry",
      title: "もう一度分析できます",
      description: "少し時間をおいてから再分析してください。",
    });

    expect(
      getAnalysisFailureGuidance({
        code: "ANALYSIS_UNAVAILABLE",
        message: "現在、分析を完了できません。",
        action: "TRY_LATER",
      }).kind,
    ).toBe("retry");
  });

  it("routes stance and recording problems to their corrective screens", () => {
    expect(
      getAnalysisFailureGuidance({
        code: "STANCE_REQUIRED",
        message: "スタンスを設定してください。",
        action: "SET_STANCE",
      }).kind,
    ).toBe("profile");
    expect(
      getAnalysisFailureGuidance({
        code: "VIDEO_REUPLOAD_REQUIRED",
        message: "動画を撮影し直してください。",
        action: "RECORD_AGAIN",
      }).kind,
    ).toBe("record");
  });

  it("shows the daily reset time in Japan time when available", () => {
    const guidance = getAnalysisFailureGuidance({
      code: "ANALYSIS_DAILY_LIMIT_REACHED",
      message: "本日の分析上限に達しました。",
      action: "WAIT_FOR_RESET",
      limit: 10,
      resetAt: "2026-08-23T15:00:00.000Z",
    });

    expect(guidance).toEqual({
      kind: "wait",
      title: "本日の分析回数に達しました",
      description:
        "本日の分析上限に達しました。 8月24日 00:00以降に再開できます。",
    });
  });

  it("uses only the public failure mapping for persisted internal failures", () => {
    const retry = getAnalysisFailureGuidance(
      publicAnalysisFailure("ANALYZE_FAILED"),
    );
    const profile = getAnalysisFailureGuidance(
      publicAnalysisFailure("STANCE_REQUIRED"),
    );
    const record = getAnalysisFailureGuidance(
      publicAnalysisFailure("ASSET_FAILED"),
    );

    expect(retry.kind).toBe("retry");
    expect(profile.kind).toBe("profile");
    expect(record.kind).toBe("record");
    expect(JSON.stringify({ retry, profile, record })).not.toContain(
      "ANALYZE_FAILED",
    );
  });
});
