import { describe, expect, it, vi } from "vitest";

import { ANALYSIS_REQUEST_ERRORS } from "./analysis-public-error";
import { createAnalysisStatusRouteHandler } from "./analysis-status-route";

const userId = "00000000-0000-4000-8000-000000000001";
const analysisId = "00000000-0000-4000-8000-000000000002";

function setup(options: {
  currentUser?: { id: string } | null;
  analysis?: {
    analysisId: string;
    status: "QUEUED" | "ANALYZING" | "COMPLETED" | "FAILED";
    error: {
      code: string;
      message: string;
      action: "RETRY_ANALYSIS";
    } | null;
    errorMessage?: string;
    rawResponse?: unknown;
    internalErrorCode?: string;
  } | null;
  analysisError?: unknown;
} = {}) {
  const currentUser =
    options.currentUser === undefined ? { id: userId } : options.currentUser;
  const analysis =
    options.analysis === undefined
      ? { analysisId, status: "ANALYZING" as const, error: null }
      : options.analysis;
  const resolveCurrentUser = vi.fn().mockResolvedValue(currentUser);
  const getOwnedAnalysisStatus = vi.fn().mockResolvedValue(analysis);
  if (options.analysisError !== undefined) {
    getOwnedAnalysisStatus.mockRejectedValue(options.analysisError);
  }
  const reportUnexpectedError = vi.fn();
  const handler = createAnalysisStatusRouteHandler({
    resolveCurrentUser,
    getOwnedAnalysisStatus,
    reportUnexpectedError,
  });

  return { getOwnedAnalysisStatus, handler, reportUnexpectedError };
}

function call(
  handler: ReturnType<typeof createAnalysisStatusRouteHandler>,
  id = analysisId,
) {
  return handler(new Request(`http://localhost/api/analyses/${id}`), {
    params: Promise.resolve({ analysisId: id }),
  });
}

describe("analysis status route", () => {
  it("returns only the safe polling fields without caching", async () => {
    const { handler } = setup({
      analysis: {
        analysisId,
        status: "FAILED",
        error: {
          code: "ANALYSIS_RETRYABLE",
          message: "時間をおいてから再分析してください。",
          action: "RETRY_ANALYSIS",
        },
        internalErrorCode: "ANALYZE_FAILED",
        errorMessage: "internal provider details",
        rawResponse: { providerPayload: "db-only" },
      },
    });

    const response = await call(handler);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      analysisId,
      status: "FAILED",
      error: {
        code: "ANALYSIS_RETRYABLE",
        message: "時間をおいてから再分析してください。",
        action: "RETRY_ANALYSIS",
      },
    });
  });

  it("returns 404 when the owner-scoped lookup cannot see the analysis", async () => {
    const { getOwnedAnalysisStatus, handler } = setup({ analysis: null });

    const response = await call(handler);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: ANALYSIS_REQUEST_ERRORS.ANALYSIS_NOT_FOUND,
    });
    expect(getOwnedAnalysisStatus).toHaveBeenCalledWith({
      userId,
      analysisId,
    });
  });

  it("returns 404 for an invalid id without querying the store", async () => {
    const { getOwnedAnalysisStatus, handler } = setup();

    const response = await call(handler, "not-a-uuid");

    expect(response.status).toBe(404);
    expect(getOwnedAnalysisStatus).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const { getOwnedAnalysisStatus, handler } = setup({ currentUser: null });

    const response = await call(handler);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: ANALYSIS_REQUEST_ERRORS.UNAUTHENTICATED,
    });
    expect(getOwnedAnalysisStatus).not.toHaveBeenCalled();
  });

  it("does not expose a database error from the owner-scoped lookup", async () => {
    const failure = new Error("postgres password=db-super-secret");
    const { handler, reportUnexpectedError } = setup({
      analysisError: failure,
    });

    const response = await call(handler);
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(serialized).toBe(
      JSON.stringify({
        error: ANALYSIS_REQUEST_ERRORS.ANALYSIS_UNAVAILABLE,
      }),
    );
    expect(serialized).not.toContain("db-super-secret");
    expect(reportUnexpectedError).toHaveBeenCalledWith(failure);
  });
});
