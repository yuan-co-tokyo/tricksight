import { describe, expect, it } from "vitest";

import { getPromptForTrick } from "./common-system-v1";

describe("getPromptForTrick", () => {
  it.each([
    ["ollie", "common-system-v1+ollie-v1"],
    ["pop-shove-it", "common-system-v1+pop-shove-it-v1"],
    ["kickflip", "common-system-v1+kickflip-v1"],
  ])("returns the composed version for %s", (trickSlug, expectedVersion) => {
    expect(getPromptForTrick(trickSlug).version).toBe(expectedVersion);
  });

  it("throws for an unsupported trick slug", () => {
    expect(() => getPromptForTrick("unknown")).toThrow(
      "未対応のトリックスラッグです: unknown",
    );
  });
});
