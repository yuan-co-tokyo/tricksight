import "server-only";

import {
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

import type { UploadObjectStore } from "./complete-upload-core";
import { getVideoUploadStorage } from "./video-upload-storage";

function isMissingObjectError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };

  return (
    candidate.name === "NotFound" ||
    candidate.name === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

export const uploadObjectStore: UploadObjectStore = {
  async inspectObject(key) {
    const storage = getVideoUploadStorage();

    try {
      const object = await storage.client.send(
        new HeadObjectCommand({
          Bucket: storage.bucket,
          Key: key,
        }),
      );

      return {
        key,
        contentLength:
          typeof object.ContentLength === "number"
            ? object.ContentLength
            : null,
        contentType: object.ContentType ?? null,
      };
    } catch (error) {
      if (isMissingObjectError(error)) return null;
      throw error;
    }
  },

  async deleteObject(key) {
    const storage = getVideoUploadStorage();

    await storage.client.send(
      new DeleteObjectCommand({
        Bucket: storage.bucket,
        Key: key,
      }),
    );
  },
};
