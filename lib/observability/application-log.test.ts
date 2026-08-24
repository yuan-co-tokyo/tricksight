import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createUnexpectedErrorReporter,
  reportApplicationError,
  reportApplicationWarning,
} from "./application-log";

describe("application logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes one searchable JSON error without messages, stacks, causes, or secrets", () => {
    const write = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("database password=db-super-secret");
    const error = Object.assign(
      new Error(
        "credential AKIAABCDEFGHIJKLMNOP https://s3.test/video?X-Amz-Signature=signed-secret",
        { cause },
      ),
      {
        code: "OBJECT_DELETE_FAILED",
        credential: "aws-session-secret",
        $metadata: {
          httpStatusCode: 403,
          requestId: "aws-request-id_123",
        },
      },
    );

    reportApplicationError({
      event: "session.deletion.failed",
      error,
      context: {
        stage: "delete_object",
        sessionId: "session-safe-id",
        apiKey: "tlk_context-secret",
        presignedUrl:
          "https://s3.test/video?X-Amz-Signature=context-signature-secret",
      },
    });

    expect(write).toHaveBeenCalledOnce();
    const serialized = String(write.mock.calls[0]?.[0]);
    const record = JSON.parse(serialized);

    expect(record).toMatchObject({
      level: "ERROR",
      event: "session.deletion.failed",
      context: {
        stage: "delete_object",
        sessionId: "session-safe-id",
        apiKey: "[REDACTED]",
        presignedUrl: "[REDACTED]",
      },
      error: {
        name: "Error",
        code: "OBJECT_DELETE_FAILED",
        httpStatusCode: 403,
        awsRequestId: "aws-request-id_123",
      },
    });
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(serialized).not.toContain("db-super-secret");
    expect(serialized).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(serialized).not.toContain("signed-secret");
    expect(serialized).not.toContain("aws-session-secret");
    expect(serialized).not.toContain("tlk_context-secret");
    expect(serialized).not.toContain("context-signature-secret");
    expect(serialized).not.toContain("stack");
    expect(serialized).not.toContain("cause");
    expect(serialized).not.toContain("message");
  });

  it("writes a structured warning without an error payload", () => {
    const write = vi.spyOn(console, "warn").mockImplementation(() => {});

    reportApplicationWarning({
      event: "analysis.stuck_detected",
      context: {
        analysisId: "analysis-safe-id",
        errorCode: "ANALYSIS_STUCK_TIMEOUT",
      },
    });

    expect(write).toHaveBeenCalledOnce();
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({
      level: "WARN",
      event: "analysis.stuck_detected",
      context: {
        analysisId: "analysis-safe-id",
        errorCode: "ANALYSIS_STUCK_TIMEOUT",
      },
    });
  });

  it("preserves dependency injection without also writing a default log", () => {
    const write = vi.spyOn(console, "error").mockImplementation(() => {});
    const reporter = vi.fn();
    const error = new Error("test failure");

    createUnexpectedErrorReporter({
      event: "upload.completion.failed",
      reporter,
    })(error, { stage: "verification" });

    expect(reporter).toHaveBeenCalledWith(error);
    expect(write).not.toHaveBeenCalled();
  });

  it("uses the structured logger when no injected reporter is present", () => {
    const write = vi.spyOn(console, "error").mockImplementation(() => {});

    createUnexpectedErrorReporter({
      event: "upload.presigned_post.failed",
    })(new Error("credential must not be logged"), { stage: "sign_post" });

    expect(write).toHaveBeenCalledOnce();
    const serialized = String(write.mock.calls[0]?.[0]);
    expect(JSON.parse(serialized)).toMatchObject({
      event: "upload.presigned_post.failed",
      context: { stage: "sign_post" },
      error: { name: "Error" },
    });
    expect(serialized).not.toContain("credential must not be logged");
  });
});
