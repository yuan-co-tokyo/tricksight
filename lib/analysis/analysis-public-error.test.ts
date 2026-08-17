import { describe, expect, it } from "vitest";

import { publicAnalysisFailure } from "./analysis-public-error";

describe("public analysis failure", () => {
  it.each([
    "ANALYSIS_STUCK_TIMEOUT",
    "ASSET_TIMEOUT",
    "ANALYZE_FAILED",
    "OUTPUT_TRUNCATED",
  ])("maps internal retryable code %s to one public code", (internalCode) => {
    expect(publicAnalysisFailure(internalCode)).toEqual({
      code: "ANALYSIS_RETRYABLE",
      message: "分析を完了できませんでした。少し時間をおいてから再分析してください。",
      action: "RETRY_ANALYSIS",
    });
  });

  it("gives stance and recording failures a concrete next action", () => {
    expect(publicAnalysisFailure("STANCE_REQUIRED")).toMatchObject({
      code: "STANCE_REQUIRED",
      action: "SET_STANCE",
    });
    expect(publicAnalysisFailure("ASSET_FAILED")).toMatchObject({
      code: "VIDEO_REUPLOAD_REQUIRED",
      action: "RECORD_AGAIN",
    });
  });

  it("does not expose unknown or configuration-only internal codes", () => {
    for (const internalCode of [
      "BUCKET_MISMATCH",
      "PROVIDER_CONFIG_MISMATCH",
      "database connection secret",
      null,
    ]) {
      const failure = publicAnalysisFailure(internalCode);

      expect(failure).toMatchObject({
        code: "ANALYSIS_UNAVAILABLE",
        action: "TRY_LATER",
      });
      expect(JSON.stringify(failure)).not.toContain(String(internalCode));
    }
  });
});
