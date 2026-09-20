import { describe, expect, it, vi } from "vitest";

import {
  detectIsoBmffVideoFormat,
  S3VideoFormatResolver,
} from "./video-container";

function ascii(value: string) {
  return Array.from(value, (character) => character.charCodeAt(0));
}

function ftyp(majorBrand: string) {
  if (majorBrand.length !== 4) throw new Error("brand must be 4 bytes");

  return new Uint8Array([
    0,
    0,
    0,
    20,
    ...ascii("ftyp"),
    ...ascii(majorBrand),
    0,
    0,
    0,
    0,
    ...ascii("isom"),
  ]);
}

describe("detectIsoBmffVideoFormat", () => {
  it("QuickTime major brandをMOVとして判定する", () => {
    expect(detectIsoBmffVideoFormat(ftyp("qt  "))).toBe("mov");
  });

  it.each(["mp42", "isom"])(
    "MP4 major brand %s をMP4として判定する",
    (majorBrand) => {
      expect(detectIsoBmffVideoFormat(ftyp(majorBrand))).toBe("mp4");
    },
  );

  it("未知のmajor brandを拡張子へフォールバックせず拒否する", () => {
    expect(() => detectIsoBmffVideoFormat(ftyp("zzzz"))).toThrow(
      '未対応のISO BMFF major brandです: "zzzz"',
    );
  });

  it("ftypボックスがない入力を拒否する", () => {
    expect(() =>
      detectIsoBmffVideoFormat(new TextEncoder().encode("not a video")),
    ).toThrow("ftypボックスを検出できませんでした");
  });
});

describe("S3VideoFormatResolver", () => {
  it("先頭4KiBだけをRange取得しbucket ownerを固定する", async () => {
    const send = vi.fn().mockResolvedValue({
      Body: {
        transformToByteArray: vi.fn().mockResolvedValue(ftyp("mp42")),
      },
    });
    const resolver = new S3VideoFormatResolver(
      { awsRegion: "ap-northeast-2", awsAccountId: "123456789012" },
      { client: { send } },
    );

    await expect(
      resolver.resolve("tricksight-videos", "private/example.mov"),
    ).resolves.toBe("mp4");

    const command = send.mock.calls[0]?.[0];
    expect(command.input).toEqual({
      Bucket: "tricksight-videos",
      Key: "private/example.mov",
      Range: "bytes=0-4095",
      ExpectedBucketOwner: "123456789012",
    });
    expect(send.mock.calls[0]?.[1]).toEqual({
      abortSignal: expect.any(AbortSignal),
    });
  });

  it("S3取得失敗を専用エラーへ変換する", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Access denied"));
    const resolver = new S3VideoFormatResolver(
      { awsRegion: "ap-northeast-2", awsAccountId: "123456789012" },
      { client: { send } },
    );

    await expect(
      resolver.resolve("tricksight-videos", "private/example.mp4"),
    ).rejects.toMatchObject({ code: "VIDEO_FORMAT_READ_FAILED" });
  });
});
