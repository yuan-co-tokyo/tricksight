import { describe, expect, it } from "vitest";

import {
  getHistoryCoverPresentation,
  type HistoryCoverVideoStatus,
} from "./history-cover";

describe("history video cover", () => {
  it.each([
    [null, "練習記録"],
    ["PENDING_UPLOAD", "アップロード確認中"],
    ["UPLOADED", "分析受付済み"],
    ["READY", "練習動画"],
    ["FAILED", "練習記録"],
  ] satisfies Array<[HistoryCoverVideoStatus, string]>) (
    "presents %s without implying a missing thumbnail",
    (videoStatus, statusLabel) => {
      const presentation = getHistoryCoverPresentation({
        trickName: "キックフリップ",
        videoStatus,
      });

      expect(presentation).toMatchObject({
        eyebrow: "TRICK PRACTICE",
        statusLabel,
      });
      expect(presentation.accessibleLabel).toContain("キックフリップ");
      expect(JSON.stringify(presentation)).not.toContain("サムネイル");
      expect(JSON.stringify(presentation)).not.toContain("準備中");
    },
  );
});
