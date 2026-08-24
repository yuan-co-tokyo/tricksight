import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionDeletionError } from "./session-deletion-core";
import { createSessionDeletionRouteHandler } from "./session-deletion-route";

const sessionId = "00000000-0000-4000-8000-000000000001";

function setup() {
  const resolveCurrentUser = vi.fn().mockResolvedValue({ id: "owner-user" });
  const deleteSession = vi.fn().mockResolvedValue({ sessionId });
  const reportUnexpectedError = vi.fn();
  const handler = createSessionDeletionRouteHandler({
    resolveCurrentUser,
    deleteSession,
    reportUnexpectedError,
  });

  return { deleteSession, handler, reportUnexpectedError, resolveCurrentUser };
}

function invoke(
  handler: ReturnType<typeof createSessionDeletionRouteHandler>,
  id = sessionId,
) {
  return handler(
    new Request(`http://localhost/api/history/${id}`, { method: "DELETE" }),
    { params: Promise.resolve({ sessionId: id }) },
  );
}

describe("session deletion route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 before deletion without an authenticated user", async () => {
    const { deleteSession, handler, resolveCurrentUser } = setup();
    resolveCurrentUser.mockResolvedValue(null);

    const response = await invoke(handler);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHENTICATED" },
    });
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it("passes only the current user and route session ID to deletion", async () => {
    const { deleteSession, handler } = setup();

    const response = await invoke(handler);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sessionId });
    expect(deleteSession).toHaveBeenCalledWith({
      userId: "owner-user",
      body: { sessionId },
    });
  });

  it("returns the same 404 for missing and another user's session", async () => {
    const { deleteSession, handler } = setup();
    deleteSession.mockRejectedValue(
      new SessionDeletionError("NOT_FOUND", "not owned"),
    );

    const response = await invoke(handler);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "SESSION_NOT_FOUND" },
    });
  });

  it("returns 409 while analysis is in progress", async () => {
    const { deleteSession, handler } = setup();
    deleteSession.mockRejectedValue(
      new SessionDeletionError("ANALYSIS_IN_PROGRESS", "still running"),
    );

    const response = await invoke(handler);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "ANALYSIS_IN_PROGRESS" },
    });
  });

  it("returns a sanitized 500 and reports the S3 cause", async () => {
    const { deleteSession, handler, reportUnexpectedError } = setup();
    const cause = new Error("AccessDenied DELETE_SECRET");
    deleteSession.mockRejectedValue(
      new SessionDeletionError(
        "OBJECT_DELETE_FAILED",
        "object failed",
        cause,
      ),
    );

    const response = await invoke(handler);
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(responseText).toContain("SESSION_DELETE_FAILED");
    expect(responseText).not.toContain("DELETE_SECRET");
    expect(reportUnexpectedError).toHaveBeenCalledWith(cause);
  });

  it("rejects a malformed session ID before the store is reached", async () => {
    const { deleteSession, handler } = setup();
    deleteSession.mockImplementation(async (input) => {
      const { deleteSessionInputSchema } = await import(
        "./session-deletion-core"
      );
      deleteSessionInputSchema.parse(input.body);
      return { sessionId };
    });

    const response = await invoke(handler, "not-a-uuid");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_REQUEST" },
    });
  });
});
