import type { S3Client } from "@aws-sdk/client-s3";
import type { PresignedPostOptions } from "@aws-sdk/s3-presigned-post";
import { describe, expect, it, vi } from "vitest";

import { MAX_VIDEO_FILE_SIZE } from "../db/mutations/pending-upload-core";

import {
  PRESIGNED_POST_EXPIRES_IN_SECONDS,
  createVideoPresignedPostCreator,
  createVideoUploadStorageConfigFromEnv,
} from "./presigned-post-core";

describe("video presigned POST", () => {
  it("reads the bucket and region only from server environment", () => {
    expect(
      createVideoUploadStorageConfigFromEnv({
        S3_BUCKET_NAME: "configured-video-bucket",
        AWS_REGION: "ap-northeast-2",
      }),
    ).toEqual({
      bucket: "configured-video-bucket",
      region: "ap-northeast-2",
    });
  });

  it.each(["S3_BUCKET_NAME", "AWS_REGION"] as const)(
    "rejects a missing %s",
    (missingName) => {
      const environment = {
        S3_BUCKET_NAME: "configured-video-bucket",
        AWS_REGION: "ap-northeast-2",
        [missingName]: "",
      };

      expect(() =>
        createVideoUploadStorageConfigFromEnv(environment),
      ).toThrow(`${missingName} is required.`);
    },
  );

  it.each([
    ["video/mp4", "private/user/session/video/original.mp4"],
    ["video/quicktime", "private/user/session/video/original.mov"],
  ] as const)(
    "passes exact key, size, type and expiry constraints for %s to the SDK",
    async (contentType, s3Key) => {
      const client = {} as S3Client;
      const createPresignedPost = vi.fn().mockResolvedValue({
        url: "https://configured-video-bucket.s3.example.com",
        fields: { key: s3Key },
      });
      const createPost = createVideoPresignedPostCreator({
        client,
        bucket: "configured-video-bucket",
        createPresignedPost,
      });

      await createPost({ s3Key, contentType });

      expect(createPresignedPost).toHaveBeenCalledOnce();
      expect(createPresignedPost.mock.calls[0]?.[0]).toBe(client);

      const options = createPresignedPost.mock.calls[0]?.[1] as
        | PresignedPostOptions
        | undefined;
      expect(options).toMatchObject({
        Bucket: "configured-video-bucket",
        Key: s3Key,
        Fields: { "Content-Type": contentType },
        Expires: PRESIGNED_POST_EXPIRES_IN_SECONDS,
      });
      expect(options?.Conditions).toContainEqual(["eq", "$key", s3Key]);
      expect(options?.Conditions).toContainEqual([
        "content-length-range",
        1,
        MAX_VIDEO_FILE_SIZE,
      ]);
      expect(options?.Conditions).toContainEqual([
        "eq",
        "$Content-Type",
        contentType,
      ]);
      expect(options?.Conditions).not.toContainEqual([
        "starts-with",
        "$key",
        expect.anything(),
      ]);
      expect(options?.Expires).toBeLessThanOrEqual(5 * 60);
    },
  );
});
