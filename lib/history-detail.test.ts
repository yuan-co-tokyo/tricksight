import { describe, expect, it } from "vitest";

import {
  formatTimestampSeconds,
  getCompletedAnalysisResult,
} from "./history-detail";

const validResult = {
  summary: "summary",
  detected: {
    trickMatchesSelection: true,
    visibility: "GOOD",
  },
  result: {
    outcome: "LANDED",
    confidence: 0.9,
  },
  scores: {
    setup: 80,
    pop: 81,
    bodyBalance: 82,
    footControl: 83,
    landing: 84,
  },
  strengths: [],
  improvements: [
    { title: "third", description: "third", priority: 3 },
    {
      title: "first",
      description: "first",
      priority: 1,
      timestampSeconds: 1.4,
    },
    { title: "second", description: "second", priority: 2 },
  ],
  nextPractice: {
    focus: "focus",
    drill: "drill",
  },
} as const;

describe("history detail presentation", () => {
  it("parses completed results and sorts improvements by priority", () => {
    const result = getCompletedAnalysisResult({
      status: "COMPLETED",
      resultJson: validResult,
    });

    expect(result?.improvements.map(({ priority }) => priority)).toEqual([
      1, 2, 3,
    ]);
    expect(result?.improvements[0]?.timestampSeconds).toBe(1.4);
  });

  it("does not expose a result for other statuses or invalid completed data", () => {
    for (const status of ["QUEUED", "ANALYZING", "FAILED"] as const) {
      expect(
        getCompletedAnalysisResult({ status, resultJson: validResult }),
      ).toBeNull();
    }

    expect(
      getCompletedAnalysisResult({
        status: "COMPLETED",
        resultJson: { rawResponse: "must-not-render" },
      }),
    ).toBeNull();
    expect(getCompletedAnalysisResult(null)).toBeNull();
  });

  it("formats video timestamps without losing fractional seconds", () => {
    expect(formatTimestampSeconds(1.4)).toBe("1.4秒");
    expect(formatTimestampSeconds(65)).toBe("1分5秒");
  });
});
