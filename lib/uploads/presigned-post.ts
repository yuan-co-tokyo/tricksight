import "server-only";

import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

import {
  createVideoPresignedPostCreator,
  type VideoPresignedPostInput,
} from "./presigned-post-core";
import { getVideoUploadStorage } from "./video-upload-storage";

export function createVideoPresignedPost(input: VideoPresignedPostInput) {
  const storage = getVideoUploadStorage();
  const createPost = createVideoPresignedPostCreator({
    client: storage.client,
    bucket: storage.bucket,
    createPresignedPost,
  });

  return createPost(input);
}
