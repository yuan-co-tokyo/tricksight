import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PendingUploadCleanupError,
  createPresignedUploadRouteHandler,
} from "./presigned-upload-route";

const pendingUpload = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  videoId: "00000000-0000-4000-8000-000000000002",
  s3Key:
    "private/user-from-session/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/original.mp4",
  contentType: "video/mp4",
  fileSize: 12_345_678,
  status: "PENDING_UPLOAD",
} as const;

const validInput = {
  trickId: "00000000-0000-4000-8000-000000000003",
  practicedAt: "2026-08-16T12:00:00.000Z",
  cameraAngle: "SIDE",
  userOutcome: "LANDED",
  memo: "着地を安定させる練習",
  video: {
    originalFilename: "practice.mp4",
    contentType: "video/mp4",
    fileSize: pendingUpload.fileSize,
  },
} as const;

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/uploads/presigned-post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setup() {
  const committedSessionIds: string[] = [];
  const committedVideoIds: string[] = [];
  const resolveCurrentUser = vi
    .fn()
    .mockResolvedValue({ id: "user-from-session" });
  const createPendingUpload = vi.fn().mockImplementation(async () => {
    committedSessionIds.push(pendingUpload.sessionId);
    committedVideoIds.push(pendingUpload.videoId);
    return pendingUpload;
  });
  const deletePendingUpload = vi.fn().mockImplementation(async (input) => {
    if (
      input.userId !== "user-from-session" ||
      input.sessionId !== pendingUpload.sessionId ||
      input.videoId !== pendingUpload.videoId
    ) {
      return false;
    }

    committedSessionIds.splice(0);
    committedVideoIds.splice(0);
    return true;
  });
  const createVideoPresignedPost = vi.fn().mockResolvedValue({
    url: "https://configured-video-bucket.s3.example.com",
    fields: {
      key: pendingUpload.s3Key,
      "Content-Type": pendingUpload.contentType,
      Policy: "signed-policy",
    },
  });
  const reportUnexpectedError = vi.fn();
  const handler = createPresignedUploadRouteHandler({
    resolveCurrentUser,
    createPendingUpload,
    deletePendingUpload,
    createVideoPresignedPost,
    reportUnexpectedError,
  });

  return {
    handler,
    resolveCurrentUser,
    createPendingUpload,
    deletePendingUpload,
    createVideoPresignedPost,
    reportUnexpectedError,
    committedSessionIds,
    committedVideoIds,
  };
}

describe("presigned upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates server-owned records before returning the upload form", async () => {
    const {
      handler,
      createPendingUpload,
      deletePendingUpload,
      createVideoPresignedPost,
      committedSessionIds,
      committedVideoIds,
    } = setup();

    const response = await handler(jsonRequest(validInput));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(createPendingUpload).toHaveBeenCalledWith(validInput);
    expect(createVideoPresignedPost).toHaveBeenCalledWith({
      s3Key: pendingUpload.s3Key,
      contentType: pendingUpload.contentType,
    });
    expect(deletePendingUpload).not.toHaveBeenCalled();
    expect(committedSessionIds).toEqual([pendingUpload.sessionId]);
    expect(committedVideoIds).toEqual([pendingUpload.videoId]);
    expect(body).toEqual({
      url: "https://configured-video-bucket.s3.example.com",
      fields: {
        key: pendingUpload.s3Key,
        "Content-Type": pendingUpload.contentType,
        Policy: "signed-policy",
      },
      sessionId: pendingUpload.sessionId,
      videoId: pendingUpload.videoId,
    });
    expect(body).not.toHaveProperty("s3Key");
  });

  it("returns 401 without calling S3 when the session is missing", async () => {
    const {
      handler,
      resolveCurrentUser,
      createPendingUpload,
      createVideoPresignedPost,
    } = setup();
    resolveCurrentUser.mockResolvedValue(null);

    const response = await handler(jsonRequest(validInput));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHENTICATED" },
    });
    expect(createPendingUpload).not.toHaveBeenCalled();
    expect(createVideoPresignedPost).not.toHaveBeenCalled();
  });

  it("returns 400 for zod-invalid input", async () => {
    const { handler, createPendingUpload, createVideoPresignedPost } = setup();
    const validationError = z.string().safeParse(42).error;
    createPendingUpload.mockRejectedValue(validationError);

    const response = await handler(jsonRequest({ userId: "attacker" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_REQUEST" },
    });
    expect(createVideoPresignedPost).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const { handler, createPendingUpload } = setup();
    const request = new Request(
      "http://localhost/api/uploads/presigned-post",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      },
    );

    const response = await handler(request);

    expect(response.status).toBe(400);
    expect(createPendingUpload).not.toHaveBeenCalled();
  });

  it("removes both pending rows when presigning fails", async () => {
    const {
      handler,
      deletePendingUpload,
      createVideoPresignedPost,
      reportUnexpectedError,
      committedSessionIds,
      committedVideoIds,
    } = setup();
    const awsError = new Error(
      "AccessDenied: credential AKIA_SHOULD_NEVER_REACH_THE_BROWSER",
    );
    createVideoPresignedPost.mockRejectedValue(awsError);

    const response = await handler(jsonRequest(validInput));
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(responseText).toBe(
      JSON.stringify({
        error: { code: "UPLOAD_INITIALIZATION_FAILED" },
      }),
    );
    expect(responseText).not.toContain("AccessDenied");
    expect(responseText).not.toContain("AKIA_SHOULD_NEVER_REACH_THE_BROWSER");
    expect(deletePendingUpload).toHaveBeenCalledWith({
      userId: "user-from-session",
      sessionId: pendingUpload.sessionId,
      videoId: pendingUpload.videoId,
    });
    expect(committedSessionIds).toEqual([]);
    expect(committedVideoIds).toEqual([]);
    expect(reportUnexpectedError).toHaveBeenCalledWith(awsError);
  });

  it("reports a compensating deletion failure without exposing either error", async () => {
    const {
      handler,
      deletePendingUpload,
      createVideoPresignedPost,
      reportUnexpectedError,
    } = setup();
    const signingError = new Error("credential AKIA_SIGNING_SECRET");
    const cleanupError = new Error("database password CLEANUP_SECRET");
    createVideoPresignedPost.mockRejectedValue(signingError);
    deletePendingUpload.mockRejectedValue(cleanupError);

    const response = await handler(jsonRequest(validInput));
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(responseText).toBe(
      JSON.stringify({
        error: { code: "UPLOAD_INITIALIZATION_FAILED" },
      }),
    );
    expect(responseText).not.toContain("AKIA_SIGNING_SECRET");
    expect(responseText).not.toContain("CLEANUP_SECRET");
    expect(reportUnexpectedError).toHaveBeenCalledOnce();
    const [reportedError] = reportUnexpectedError.mock.calls[0];
    expect(reportedError).toBeInstanceOf(PendingUploadCleanupError);
    expect(reportedError).toMatchObject({
      cause: signingError,
      cleanupError,
    });
  });

  it("reports when cleanup cannot confirm that the pending rows were deleted", async () => {
    const {
      handler,
      deletePendingUpload,
      createVideoPresignedPost,
      reportUnexpectedError,
    } = setup();
    createVideoPresignedPost.mockRejectedValue(new Error("signing failed"));
    deletePendingUpload.mockResolvedValue(false);

    const response = await handler(jsonRequest(validInput));

    expect(response.status).toBe(500);
    expect(reportUnexpectedError).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "PendingUploadCleanupError",
        cleanupError: expect.objectContaining({
          message: "No matching pending upload was deleted.",
        }),
      }),
    );
  });
});
