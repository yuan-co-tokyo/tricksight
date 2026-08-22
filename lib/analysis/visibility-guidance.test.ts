import { describe, expect, it } from "vitest";

import { SLOW_MOTION_VIDEO_GUIDANCE } from "../uploads/slow-motion-guidance";
import { getVisibilityGuidance } from "./visibility-guidance";

describe("analysis visibility guidance", () => {
  it("does not interrupt a result with good visibility", () => {
    expect(getVisibilityGuidance("GOOD")).toBeNull();
  });

  it("guides both partial and poor results without presenting them as failed", () => {
    const partial = getVisibilityGuidance("PARTIAL");
    const poor = getVisibilityGuidance("POOR");

    expect(partial?.title).toContain("一部");
    expect(poor?.title).toContain("十分に確認できませんでした");
    expect(partial?.resultContext).toContain("分析は完了しています");
    expect(poor?.resultContext).toContain("分析は完了しています");
  });

  it("reuses the upload screen's slow-motion guidance exactly", () => {
    for (const visibility of ["PARTIAL", "POOR"] as const) {
      const guidance = getVisibilityGuidance(visibility);

      expect(guidance?.requirement).toBe(
        SLOW_MOTION_VIDEO_GUIDANCE.requirement,
      );
      expect(guidance?.explanation).toBe(
        SLOW_MOTION_VIDEO_GUIDANCE.explanation,
      );
    }
  });
});
