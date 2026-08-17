import { describe, expect, it, vi } from "vitest";

import { QueuedAnalysisCreationError } from "../db/mutations/queued-analysis-core";

import { createAnalysisRouteHandler } from "./analysis-route";

const analysisId = "00000000-0000-4000-8000-000000000001";
const videoId = "00000000-0000-4000-8000-000000000002";

function request(body: unknown = { videoId }) {
  return new Request("http://localhost/api/analyses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setup() {
  const scheduled: Array<() => Promise<void>> = [];
  const createQueuedAnalysis = vi.fn().mockResolvedValue({
    outcome: "CREATED",
    analysis: {
      id: analysisId,
      videoId,
      provider: "twelvelabs",
      modelId: "pegasus1.5",
      promptVersion: "common-system-v1+kickflip-v1",
      status: "QUEUED",
    },
  });
  const runQueuedAnalysis = vi.fn().mockResolvedValue({
    outcome: "COMPLETED",
    analysisId,
  });
  const reportUnexpectedError = vi.fn();
  const handler = createAnalysisRouteHandler({
    createQueuedAnalysis,
    runQueuedAnalysis,
    scheduleAfter: (callback) => scheduled.push(callback),
    reportUnexpectedError,
  });

  return {
    createQueuedAnalysis,
    handler,
    reportUnexpectedError,
    runQueuedAnalysis,
    scheduled,
  };
}

describe("analysis route", () => {
  it("returns 202 and schedules an awaited background analysis", async () => {
    const { handler, runQueuedAnalysis, scheduled } = setup();

    const response = await handler(request());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      analysisId,
      status: "QUEUED",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(scheduled).toHaveLength(1);
    expect(runQueuedAnalysis).not.toHaveBeenCalled();

    await scheduled[0]();
    expect(runQueuedAnalysis).toHaveBeenCalledOnce();
    expect(runQueuedAnalysis).toHaveBeenCalledWith(analysisId);
  });

  it("returns an existing in-progress analysis without scheduling it again", async () => {
    const { createQueuedAnalysis, handler, scheduled } = setup();
    createQueuedAnalysis.mockResolvedValue({
      outcome: "ALREADY_IN_PROGRESS",
      analysis: {
        id: analysisId,
        videoId,
        provider: "twelvelabs",
        modelId: "pegasus1.5",
        promptVersion: "common-system-v1+kickflip-v1",
        status: "ANALYZING",
      },
    });

    const response = await handler(request());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      analysisId,
      status: "ANALYZING",
    });
    expect(scheduled).toHaveLength(0);
  });

  it("schedules an existing QUEUED analysis so the atomic claim can recover it", async () => {
    const { createQueuedAnalysis, handler, scheduled } = setup();
    createQueuedAnalysis.mockResolvedValue({
      outcome: "ALREADY_IN_PROGRESS",
      analysis: {
        id: analysisId,
        videoId,
        provider: "twelvelabs",
        modelId: "pegasus1.5",
        promptVersion: "common-system-v1+kickflip-v1",
        status: "QUEUED",
      },
    });

    await handler(request());

    expect(scheduled).toHaveLength(1);
  });

  it("does not expose raw provider data in the response", async () => {
    const { handler } = setup();

    const body = await (await handler(request())).json();

    expect(body).not.toHaveProperty("rawResponse");
    expect(JSON.stringify(body)).not.toContain("providerPayload");
  });

  it("maps ownership and video state failures to meaningful responses", async () => {
    for (const [code, status] of [
      ["VIDEO_NOT_FOUND", 404],
      ["VIDEO_NOT_READY", 409],
    ] as const) {
      const { createQueuedAnalysis, handler } = setup();
      createQueuedAnalysis.mockRejectedValue(
        new QueuedAnalysisCreationError(code, "not available"),
      );

      const response = await handler(request());

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error: { code } });
    }
  });

  it("returns a dedicated error code when the profile stance is missing", async () => {
    const { createQueuedAnalysis, handler, scheduled } = setup();
    createQueuedAnalysis.mockRejectedValue(
      new QueuedAnalysisCreationError(
        "STANCE_REQUIRED",
        "set a profile stance",
      ),
    );

    const response = await handler(request());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: { code: "STANCE_REQUIRED" },
    });
    expect(scheduled).toHaveLength(0);
  });

  it("reports a rejected background task without leaving an unhandled promise", async () => {
    const { handler, reportUnexpectedError, runQueuedAnalysis, scheduled } =
      setup();
    const failure = new Error("database write failed");
    runQueuedAnalysis.mockRejectedValue(failure);

    await handler(request());
    await scheduled[0]();

    expect(reportUnexpectedError).toHaveBeenCalledWith(failure);
  });
});
