import { describe, expect, it } from "vitest";

import { resolveVideoAnalysisProviderSelection } from "./provider-selection";

describe("resolveVideoAnalysisProviderSelection", () => {
  it("未設定または空白ならBedrock Novaを選ぶ", () => {
    expect(resolveVideoAnalysisProviderSelection({})).toBe("bedrock-nova");
    expect(
      resolveVideoAnalysisProviderSelection({ VIDEO_ANALYSIS_PROVIDER: " " }),
    ).toBe("bedrock-nova");
  });

  it("TwelveLabs直接接続を明示設定で選べる", () => {
    expect(
      resolveVideoAnalysisProviderSelection({
        VIDEO_ANALYSIS_PROVIDER: " twelvelabs-direct ",
      }),
    ).toBe("twelvelabs-direct");
  });

  it("Bedrock Pegasusを明示設定で選べる", () => {
    expect(
      resolveVideoAnalysisProviderSelection({
        VIDEO_ANALYSIS_PROVIDER: " bedrock-pegasus ",
      }),
    ).toBe("bedrock-pegasus");
  });

  it("Bedrock Novaを明示設定でも選べる", () => {
    expect(
      resolveVideoAnalysisProviderSelection({
        VIDEO_ANALYSIS_PROVIDER: " bedrock-nova ",
      }),
    ).toBe("bedrock-nova");
  });

  it("未知の設定値を拒否する", () => {
    expect(() =>
      resolveVideoAnalysisProviderSelection({
        VIDEO_ANALYSIS_PROVIDER: "pegasus",
      }),
    ).toThrow("VIDEO_ANALYSIS_PROVIDER is invalid: pegasus");
  });
});
