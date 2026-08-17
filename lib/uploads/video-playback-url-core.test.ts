import { describe, expect, it, vi } from "vitest";

import {
  VIDEO_PLAYBACK_URL_EXPIRES_IN_SECONDS,
  createOwnedVideoPlaybackUrlCreator,
  type PlaybackVideoStatus,
} from "./video-playback-url-core";

const video = {
  s3Key: "private/owner/session/video/original.mp4",
  status: "UPLOADED" as PlaybackVideoStatus,
};

function setup() {
  const signPlaybackUrl = vi
    .fn()
    .mockResolvedValue("https://signed.example/video.mp4");
  const createUrl = createOwnedVideoPlaybackUrlCreator({ signPlaybackUrl });

  return { createUrl, signPlaybackUrl };
}

describe("owned video playback URL", () => {
  it("does not issue a URL when the owner-scoped session is absent", async () => {
    const { createUrl, signPlaybackUrl } = setup();

    await expect(createUrl(null)).resolves.toBeNull();
    expect(signPlaybackUrl).not.toHaveBeenCalled();
  });

  it.each(["PENDING_UPLOAD", "FAILED"] as const)(
    "does not issue a URL for %s",
    async (status) => {
      const { createUrl, signPlaybackUrl } = setup();

      await expect(
        createUrl({ video: { ...video, status } }),
      ).resolves.toBeNull();
      expect(signPlaybackUrl).not.toHaveBeenCalled();
    },
  );

  it.each(["UPLOADED", "READY"] as const)(
    "issues a 15-minute URL for %s",
    async (status) => {
      const { createUrl, signPlaybackUrl } = setup();

      await expect(
        createUrl({ video: { ...video, status } }),
      ).resolves.toBe("https://signed.example/video.mp4");
      expect(signPlaybackUrl).toHaveBeenCalledWith({
        s3Key: video.s3Key,
        expiresInSeconds: VIDEO_PLAYBACK_URL_EXPIRES_IN_SECONDS,
      });
    },
  );
});
