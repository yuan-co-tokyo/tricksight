import { describe, expect, it } from "vitest";

import { resolveVideoAnalysisProviderSelection } from "./provider-selection";

describe("resolveVideoAnalysisProviderSelection", () => {
  it("未設定または空白なら既存のTwelveLabs直接接続を選ぶ", () => {
    expect(resolveVideoAnalysisProviderSelection({})).toBe(
      "twelvelabs-direct",
    );
    expect(
      resolveVideoAnalysisProviderSelection({ VIDEO_ANALYSIS_PROVIDER: " " }),
    ).toBe("twelvelabs-direct");
  });

  it("明示設定時だけBedrock Pegasusを選ぶ", () => {
    expect(
      resolveVideoAnalysisProviderSelection({
        VIDEO_ANALYSIS_PROVIDER: " bedrock-pegasus ",
      }),
    ).toBe("bedrock-pegasus");
  });

  it("Bedrock Novaも明示設定時だけ選ぶ", () => {
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
