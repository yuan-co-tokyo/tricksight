import "server-only";

import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

import {
  createVideoPresignedPostCreator,
  createVideoUploadStorageConfigFromEnv,
  type VideoPresignedPostInput,
} from "./presigned-post-core";

const clientsByRegion = new Map<string, S3Client>();

function getS3Client(region: string) {
  let client = clientsByRegion.get(region);

  if (!client) {
    // 認証情報を明示せず、AWS SDKの既定チェーンを使う。
    client = new S3Client({ region });
    clientsByRegion.set(region, client);
  }

  return client;
}

export function createVideoPresignedPost(input: VideoPresignedPostInput) {
  const config = createVideoUploadStorageConfigFromEnv();
  const createPost = createVideoPresignedPostCreator({
    client: getS3Client(config.region),
    bucket: config.bucket,
    createPresignedPost,
  });

  return createPost(input);
}
