import { S3Client } from "@aws-sdk/client-s3";

import { createAwsClientConfig } from "../aws/client-config";

import { createVideoUploadStorageConfigFromEnv } from "./presigned-post-core";

const clientsByRegion = new Map<string, S3Client>();

function getS3Client(region: string) {
  let client = clientsByRegion.get(region);

  if (!client) {
    client = new S3Client(createAwsClientConfig({ region }));
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
