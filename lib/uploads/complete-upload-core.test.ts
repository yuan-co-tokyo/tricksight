import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  UploadCompletionError,
  createCompleteUploadService,
  type CompleteUploadStore,
  type OwnedVideoUpload,
  type UploadObjectStore,
} from "./complete-upload-core";

const ids = {
  session: "00000000-0000-4000-8000-000000000001",
  video: "00000000-0000-4000-8000-000000000002",
} as const;

const video: OwnedVideoUpload = {
  id: ids.video,
  sessionId: ids.session,
  s3Key: `private/user-from-session/${ids.session}/${ids.video}/original.mp4`,
  contentType: "video/mp4",
  fileSize: 12_345_678,
  status: "PENDING_UPLOAD",
};

const validBody = {
  sessionId: ids.session,
  videoId: ids.video,
};

function setup() {
  const store: CompleteUploadStore = {
    findOwnedVideo: vi.fn().mockResolvedValue(video),
    transitionPendingToUploaded: vi.fn().mockResolvedValue({
      status: "UPLOADED",
      updated: true,
    }),
    markPendingAsFailed: vi.fn().mockResolvedValue(undefined),
  };
  const objects: UploadObjectStore = {
    inspectObject: vi.fn().mockResolvedValue({
      key: video.s3Key,
      contentLength: video.fileSize,
      contentType: video.contentType,
    }),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  };
  const completeUpload = createCompleteUploadService({ store, objects });

  return { completeUpload, store, objects };
}

describe("complete upload service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns NOT_FOUND before S3 access when the video is not owned", async () => {
    const { completeUpload, store, objects } = setup();
    vi.mocked(store.findOwnedVideo).mockResolvedValue(null);

    await expect(
      completeUpload({ userId: "attacker", body: validBody }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<UploadCompletionError>);
    expect(store.findOwnedVideo).toHaveBeenCalledWith({
      userId: "attacker",
      ...validBody,
    });
    expect(objects.inspectObject).not.toHaveBeenCalled();
  });

  it("deletes a size-mismatched object and marks the row FAILED", async () => {
    const { completeUpload, store, objects } = setup();
    vi.mocked(objects.inspectObject).mockResolvedValue({
      key: video.s3Key,
      contentLength: video.fileSize + 1,
      contentType: video.contentType,
    });

    await expect(
      completeUpload({ userId: "user-from-session", body: validBody }),
    ).rejects.toMatchObject({
      code: "VERIFICATION_FAILED",
    } satisfies Partial<UploadCompletionError>);
    expect(objects.deleteObject).toHaveBeenCalledWith(video.s3Key);
    expect(store.markPendingAsFailed).toHaveBeenCalledWith(video.id);
    expect(store.transitionPendingToUploaded).not.toHaveBeenCalled();
  });

  it("deletes a Content-Type-mismatched object and marks the row FAILED", async () => {
    const { completeUpload, store, objects } = setup();
    vi.mocked(objects.inspectObject).mockResolvedValue({
      key: video.s3Key,
      contentLength: video.fileSize,
      contentType: "video/quicktime",
    });

    await expect(
      completeUpload({ userId: "user-from-session", body: validBody }),
    ).rejects.toMatchObject({
      code: "VERIFICATION_FAILED",
    } satisfies Partial<UploadCompletionError>);
    expect(objects.deleteObject).toHaveBeenCalledWith(video.s3Key);
    expect(store.markPendingAsFailed).toHaveBeenCalledWith(video.id);
  });

  it("deletes an object whose inspected key does not match the DB key", async () => {
    const { completeUpload, store, objects } = setup();
    vi.mocked(objects.inspectObject).mockResolvedValue({
      key: `${video.s3Key}-unexpected`,
      contentLength: video.fileSize,
      contentType: video.contentType,
    });

    await expect(
      completeUpload({ userId: "user-from-session", body: validBody }),
    ).rejects.toMatchObject({
      code: "VERIFICATION_FAILED",
    } satisfies Partial<UploadCompletionError>);
    expect(objects.deleteObject).toHaveBeenCalledWith(video.s3Key);
    expect(store.markPendingAsFailed).toHaveBeenCalledWith(video.id);
  });

  it("keeps the DB row pending when deleting an invalid object fails", async () => {
    const { completeUpload, store, objects } = setup();
    vi.mocked(objects.inspectObject).mockResolvedValue({
      key: video.s3Key,
      contentLength: video.fileSize + 1,
      contentType: video.contentType,
    });
    vi.mocked(objects.deleteObject).mockRejectedValue(
      new Error("AccessDenied: secret AWS detail"),
    );

    await expect(
      completeUpload({ userId: "user-from-session", body: validBody }),
    ).rejects.toMatchObject({
      code: "CLEANUP_FAILED",
    } satisfies Partial<UploadCompletionError>);
    expect(store.markPendingAsFailed).not.toHaveBeenCalled();
    expect(store.transitionPendingToUploaded).not.toHaveBeenCalled();
  });

  it("marks a matching object UPLOADED", async () => {
    const { completeUpload, store, objects } = setup();

    await expect(
      completeUpload({ userId: "user-from-session", body: validBody }),
    ).resolves.toEqual({ status: "UPLOADED", idempotent: false });
    expect(objects.inspectObject).toHaveBeenCalledWith(video.s3Key);
    expect(store.transitionPendingToUploaded).toHaveBeenCalledWith(video.id);
    expect(objects.deleteObject).not.toHaveBeenCalled();
  });

  it.each(["UPLOADED", "READY"] as const)(
    "treats an already %s upload as an idempotent success",
    async (status) => {
      const { completeUpload, store, objects } = setup();
      vi.mocked(store.findOwnedVideo).mockResolvedValue({ ...video, status });

      await expect(
        completeUpload({ userId: "user-from-session", body: validBody }),
      ).resolves.toEqual({ status, idempotent: true });
      expect(objects.inspectObject).not.toHaveBeenCalled();
      expect(store.transitionPendingToUploaded).not.toHaveBeenCalled();
    },
  );

  it("accepts a concurrent duplicate after the conditional update loses", async () => {
    const { completeUpload, store } = setup();
    vi.mocked(store.transitionPendingToUploaded).mockResolvedValue({
      status: "UPLOADED",
      updated: false,
    });

    await expect(
      completeUpload({ userId: "user-from-session", body: validBody }),
    ).resolves.toEqual({ status: "UPLOADED", idempotent: true });
  });
});
