import type { S3Client } from "@aws-sdk/client-s3";
import type {
  PresignedPost,
  PresignedPostOptions,
} from "@aws-sdk/s3-presigned-post";

import {
  MAX_VIDEO_FILE_SIZE,
  type AllowedVideoContentType,
} from "../db/mutations/pending-upload-core";

export const PRESIGNED_POST_EXPIRES_IN_SECONDS = 5 * 60;

type Environment = Readonly<Record<string, string | undefined>>;

export type VideoPresignedPostInput = {
  s3Key: string;
  contentType: AllowedVideoContentType;
};

type CreatePresignedPost = (
  client: S3Client,
  options: PresignedPostOptions,
) => Promise<PresignedPost>;

function requiredEnvironment(environment: Environment, name: string) {
  const value = environment[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

export function createVideoUploadStorageConfigFromEnv(
  environment: Environment = process.env,
) {
  return {
    bucket: requiredEnvironment(environment, "S3_BUCKET_NAME"),
    region: requiredEnvironment(environment, "AWS_REGION"),
  };
}

export function buildVideoPresignedPostOptions(input: {
  bucket: string;
  s3Key: string;
  contentType: AllowedVideoContentType;
}): PresignedPostOptions {
  const conditions: NonNullable<PresignedPostOptions["Conditions"]> = [
    ["eq", "$key", input.s3Key],
    ["content-length-range", 1, MAX_VIDEO_FILE_SIZE],
    ["eq", "$Content-Type", input.contentType],
  ];

  return {
    Bucket: input.bucket,
    Key: input.s3Key,
    Conditions: conditions,
    Fields: {
      "Content-Type": input.contentType,
    },
    Expires: PRESIGNED_POST_EXPIRES_IN_SECONDS,
  };
}

export function createVideoPresignedPostCreator(dependencies: {
  client: S3Client;
  bucket: string;
  createPresignedPost: CreatePresignedPost;
}) {
  return function createVideoPresignedPost(input: VideoPresignedPostInput) {
    return dependencies.createPresignedPost(
      dependencies.client,
      buildVideoPresignedPostOptions({
        bucket: dependencies.bucket,
        s3Key: input.s3Key,
        contentType: input.contentType,
      }),
    );
  };
}
