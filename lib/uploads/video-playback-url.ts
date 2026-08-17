import "server-only";

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { createOwnedVideoPlaybackUrlCreator } from "./video-playback-url-core";
import { getVideoUploadStorage } from "./video-upload-storage";

export class VideoPlaybackUrlError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("The video playback URL could not be issued.");
    this.name = "VideoPlaybackUrlError";
    this.cause = cause;
  }
}

async function signPlaybackUrl(input: {
  s3Key: string;
  expiresInSeconds: number;
}) {
  const storage = getVideoUploadStorage();

  try {
    return await getSignedUrl(
      storage.client,
      new GetObjectCommand({
        Bucket: storage.bucket,
        Key: input.s3Key,
      }),
      { expiresIn: input.expiresInSeconds },
    );
  } catch (cause) {
    // AWSの生エラーは呼び出し元へ直接公開しない。
    throw new VideoPlaybackUrlError(cause);
  }
}

export const createOwnedVideoPlaybackUrl =
  createOwnedVideoPlaybackUrlCreator({ signPlaybackUrl });
