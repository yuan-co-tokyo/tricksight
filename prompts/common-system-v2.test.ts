import { describe, expect, it } from "vitest";

import { prompt as v1Prompt } from "./common-system-v1";
import { getPromptForTrick, prompt } from "./common-system-v2";

describe("common system v2", () => {
  it.each([
    ["ollie", "common-system-v2+ollie-v1"],
    ["pop-shove-it", "common-system-v2+pop-shove-it-v1"],
    ["kickflip", "common-system-v2+kickflip-v1"],
  ])("resolves %s with an immutable composite version", (trickSlug, expected) => {
    expect(getPromptForTrick(trickSlug).version).toBe(expected);
  });

  it("specifies that confidence uses a zero-to-one scale", () => {
    expect(v1Prompt).not.toContain("confidenceは**0以上1以下の小数**");
    expect(prompt).toContain("confidenceは**0以上1以下の小数**");
    expect(prompt).toContain("scoresの0〜100とは尺度が異なります");
    expect(prompt).toContain("1を超える値やパーセント表記（90など）は使用しない");
  });
});
