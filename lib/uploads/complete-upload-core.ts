import { z } from "zod";

export const completeUploadInputSchema = z.strictObject({
  sessionId: z.uuid(),
  videoId: z.uuid(),
});

export type CompleteUploadInput = z.input<typeof completeUploadInputSchema>;

export type VideoUploadStatus =
  | "PENDING_UPLOAD"
  | "UPLOADED"
  | "READY"
  | "FAILED";

export type OwnedVideoUpload = {
  id: string;
  sessionId: string;
  s3Key: string;
  contentType: string;
  fileSize: number;
  status: VideoUploadStatus;
};

export type InspectedUploadObject = {
  key: string;
  contentLength: number | null;
  contentType: string | null;
};

export interface CompleteUploadStore {
  findOwnedVideo(input: {
    userId: string;
    sessionId: string;
    videoId: string;
  }): Promise<OwnedVideoUpload | null>;
  transitionPendingToUploaded(videoId: string): Promise<{
    status: VideoUploadStatus | null;
    updated: boolean;
  }>;
  markPendingAsFailed(videoId: string): Promise<void>;
}

export interface UploadObjectStore {
  inspectObject(key: string): Promise<InspectedUploadObject | null>;
  deleteObject(key: string): Promise<void>;
}

export type UploadCompletionErrorCode =
  | "NOT_FOUND"
  | "NOT_COMPLETABLE"
  | "VERIFICATION_FAILED"
  | "CLEANUP_FAILED";

export class UploadCompletionError extends Error {
  readonly code: UploadCompletionErrorCode;
  readonly cause?: unknown;

  constructor(
    code: UploadCompletionErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "UploadCompletionError";
    this.code = code;
    this.cause = cause;
  }
}

function completedResult(status: "UPLOADED" | "READY", idempotent: boolean) {
  return { status, idempotent } as const;
}

export function createCompleteUploadService(dependencies: {
  store: CompleteUploadStore;
  objects: UploadObjectStore;
}) {
  return async function completeUpload(input: {
    userId: string;
    body: unknown;
  }) {
    const parsed = completeUploadInputSchema.parse(input.body);
    const video = await dependencies.store.findOwnedVideo({
      userId: input.userId,
      sessionId: parsed.sessionId,
      videoId: parsed.videoId,
    });

    // 所有者不一致と不存在を同じNOT_FOUNDにし、他ユーザーの存在を示唆しない。
    if (!video) {
      throw new UploadCompletionError(
        "NOT_FOUND",
        "The requested upload was not found.",
      );
    }

    if (video.status === "UPLOADED" || video.status === "READY") {
      return completedResult(video.status, true);
    }

    if (video.status === "FAILED") {
      throw new UploadCompletionError(
        "NOT_COMPLETABLE",
        "A failed upload cannot be completed.",
      );
    }

    const object = await dependencies.objects.inspectObject(video.s3Key);

    if (!object) {
      await dependencies.store.markPendingAsFailed(video.id);
      throw new UploadCompletionError(
        "VERIFICATION_FAILED",
        "The uploaded object does not exist.",
      );
    }

    const objectMatchesDatabase =
      object.key === video.s3Key &&
      object.contentLength === video.fileSize &&
      object.contentType === video.contentType;

    if (!objectMatchesDatabase) {
      try {
        await dependencies.objects.deleteObject(video.s3Key);
      } catch (error) {
        // 削除できていないオブジェクトをFAILEDやUPLOADEDへ進めず、再試行可能にする。
        throw new UploadCompletionError(
          "CLEANUP_FAILED",
          "The invalid upload object could not be deleted.",
          error,
        );
      }

      await dependencies.store.markPendingAsFailed(video.id);
      throw new UploadCompletionError(
        "VERIFICATION_FAILED",
        "The uploaded object did not match its database record.",
      );
    }

    const transition =
      await dependencies.store.transitionPendingToUploaded(video.id);

    if (transition.status === "UPLOADED" || transition.status === "READY") {
      // 条件付きUPDATEに負けた重複通知も、既に完了済みなら成功として扱う。
      return completedResult(transition.status, !transition.updated);
    }

    if (transition.status === null) {
      throw new UploadCompletionError(
        "NOT_FOUND",
        "The upload disappeared while it was being completed.",
      );
    }

    throw new UploadCompletionError(
      "NOT_COMPLETABLE",
      "The upload is no longer completable.",
    );
  };
}
