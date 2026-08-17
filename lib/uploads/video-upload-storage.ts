import "server-only";

import { S3Client } from "@aws-sdk/client-s3";

import { createVideoUploadStorageConfigFromEnv } from "./presigned-post-core";

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

export function getVideoUploadStorage() {
  const config = createVideoUploadStorageConfigFromEnv();

  return {
    bucket: config.bucket,
    client: getS3Client(config.region),
  };
}
