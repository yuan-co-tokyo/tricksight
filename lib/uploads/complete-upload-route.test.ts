import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UploadCompletionError } from "./complete-upload-core";
import { createCompleteUploadRouteHandler } from "./complete-upload-route";

const body = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  videoId: "00000000-0000-4000-8000-000000000002",
};

function jsonRequest(value: unknown = body) {
  return new Request("http://localhost/api/uploads/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

function setup() {
  const resolveCurrentUser = vi
    .fn()
    .mockResolvedValue({ id: "user-from-session" });
  const completeUpload = vi.fn().mockResolvedValue({
    status: "UPLOADED",
    idempotent: false,
  });
  const reportUnexpectedError = vi.fn();
  const handler = createCompleteUploadRouteHandler({
    resolveCurrentUser,
    completeUpload,
    reportUnexpectedError,
  });

  return {
    handler,
    resolveCurrentUser,
    completeUpload,
    reportUnexpectedError,
  };
}

describe("complete upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns UPLOADED after verification", async () => {
    const { handler, completeUpload } = setup();

    const response = await handler(jsonRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "UPLOADED",
      idempotent: false,
    });
    expect(completeUpload).toHaveBeenCalledWith({
      userId: "user-from-session",
      body,
    });
  });

  it("returns 404 for an unowned video without revealing why", async () => {
    const { handler, completeUpload } = setup();
    completeUpload.mockRejectedValue(
      new UploadCompletionError("NOT_FOUND", "belongs to another user"),
    );

    const response = await handler(jsonRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UPLOAD_NOT_FOUND" },
    });
  });

  it("returns 422 for a verified mismatch", async () => {
    const { handler, completeUpload } = setup();
    completeUpload.mockRejectedValue(
      new UploadCompletionError(
        "VERIFICATION_FAILED",
        "Content-Type mismatch",
      ),
    );

    const response = await handler(jsonRequest());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UPLOAD_VERIFICATION_FAILED" },
    });
  });

  it("returns 401 before completion when the session is missing", async () => {
    const { handler, resolveCurrentUser, completeUpload } = setup();
    resolveCurrentUser.mockResolvedValue(null);

    const response = await handler(jsonRequest());

    expect(response.status).toBe(401);
    expect(completeUpload).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid input", async () => {
    const { handler, completeUpload } = setup();
    completeUpload.mockRejectedValue(z.uuid().safeParse("bad-id").error);

    const response = await handler(jsonRequest({ videoId: "bad-id" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("does not expose a raw AWS deletion error", async () => {
    const { handler, completeUpload, reportUnexpectedError } = setup();
    const awsError = new Error(
      "AccessDenied: credential AKIA_SHOULD_NEVER_REACH_THE_BROWSER",
    );
    completeUpload.mockRejectedValue(
      new UploadCompletionError(
        "CLEANUP_FAILED",
        "cleanup failed",
        awsError,
      ),
    );

    const response = await handler(jsonRequest());
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(responseText).toBe(
      JSON.stringify({ error: { code: "UPLOAD_COMPLETION_FAILED" } }),
    );
    expect(responseText).not.toContain("AccessDenied");
    expect(responseText).not.toContain("AKIA_SHOULD_NEVER_REACH_THE_BROWSER");
    expect(reportUnexpectedError).toHaveBeenCalledWith(awsError);
  });
});
