import { describe, expect, it } from "vitest";

import {
  validateVideoDuration,
  validateVideoFileBasics,
} from "./client-video-validation";
import { MAX_VIDEO_FILE_SIZE } from "./video-constraints";

describe("client video validation", () => {
  it.each([
    ["practice.mp4", "video/mp4", "video/mp4"],
    ["practice.MOV", "video/quicktime", "video/quicktime"],
    ["practice.mp4", "", "video/mp4"],
  ] as const)(
    "accepts %s with browser type %s",
    (name, type, expectedContentType) => {
      expect(
        validateVideoFileBasics({ name, type, size: 1_024 }),
      ).toEqual({ success: true, contentType: expectedContentType });
    },
  );

  it.each([
    ["practice.webm", "video/webm"],
    ["practice.mp4", "video/quicktime"],
    ["practice.mov", "video/mp4"],
  ])("rejects unsupported or mismatched type %s / %s", (name, type) => {
    expect(validateVideoFileBasics({ name, type, size: 1_024 })).toEqual({
      success: false,
      message: "MP4またはMOV形式の動画を選んでください。",
    });
  });

  it("rejects a file larger than 100 MiB", () => {
    expect(
      validateVideoFileBasics({
        name: "practice.mp4",
        type: "video/mp4",
        size: MAX_VIDEO_FILE_SIZE + 1,
      }),
    ).toEqual({
      success: false,
      message: "動画ファイルは100MB以下にしてください。",
    });
  });

  it.each([3, 3.001, 20])("accepts a %s second video", (duration) => {
    expect(validateVideoDuration(duration)).toEqual({ success: true });
  });

  it.each([2.999, 20.001, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid duration %s",
    (duration) => {
      expect(validateVideoDuration(duration)).toMatchObject({
        success: false,
      });
    },
  );
});
