import { describe, expect, it, vi } from "vitest";

import {
  createOwnedAnalysisStatusReader,
  STUCK_ANALYSIS_ERROR_CODE,
  STUCK_ANALYSIS_THRESHOLD_MS,
  type AnalysisStatusStore,
  type OwnedAnalysisStatusRecord,
} from "./analysis-status-core";

const userId = "00000000-0000-4000-8000-000000000001";
const analysisId = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-17T03:00:00.000Z");

const analyzing = {
  id: analysisId,
  status: "ANALYZING",
  startedAt: new Date("2026-08-17T02:49:59.999Z"),
  errorCode: null,
} satisfies OwnedAnalysisStatusRecord;

function setup(options: {
  first?: OwnedAnalysisStatusRecord | null;
  failed?: OwnedAnalysisStatusRecord | null;
  concurrent?: OwnedAnalysisStatusRecord | null;
} = {}) {
  const first = options.first === undefined ? analyzing : options.first;
  const reads = [first];
  if (options.concurrent !== undefined) reads.push(options.concurrent);

  const findOwnedAnalysis = vi.fn(async () => reads.shift() ?? null);
  const failed =
    options.failed === undefined
      ? {
          ...analyzing,
          status: "FAILED" as const,
          errorCode: STUCK_ANALYSIS_ERROR_CODE,
        }
      : options.failed;
  const failOwnedStuckAnalysis = vi.fn(async () => failed);
  const store = {
    findOwnedAnalysis,
    failOwnedStuckAnalysis,
  } satisfies AnalysisStatusStore;
  const reader = createOwnedAnalysisStatusReader({ store, now: () => now });

  return { failOwnedStuckAnalysis, findOwnedAnalysis, reader };
}

describe("owned analysis status reader", () => {
  it("conditionally fails an ANALYZING record older than ten minutes", async () => {
    const { failOwnedStuckAnalysis, reader } = setup();

    await expect(reader({ userId, analysisId })).resolves.toEqual({
      analysisId,
      status: "FAILED",
      errorCode: STUCK_ANALYSIS_ERROR_CODE,
    });
    expect(failOwnedStuckAnalysis).toHaveBeenCalledWith({
      userId,
      analysisId,
      startedBefore: new Date(
        now.getTime() - STUCK_ANALYSIS_THRESHOLD_MS,
      ),
      completedAt: now,
      errorCode: STUCK_ANALYSIS_ERROR_CODE,
      errorMessage: expect.stringContaining("スタック検出"),
    });
  });

  it("leaves an ANALYZING record within the threshold unchanged", async () => {
    const { failOwnedStuckAnalysis, reader } = setup({
      first: {
        ...analyzing,
        startedAt: new Date("2026-08-17T02:50:00.001Z"),
      },
    });

    await expect(reader({ userId, analysisId })).resolves.toEqual({
      analysisId,
      status: "ANALYZING",
      errorCode: null,
    });
    expect(failOwnedStuckAnalysis).not.toHaveBeenCalled();
  });

  it("does not fail a record exactly at the ten-minute boundary", async () => {
    const { failOwnedStuckAnalysis, reader } = setup({
      first: {
        ...analyzing,
        startedAt: new Date("2026-08-17T02:50:00.000Z"),
      },
    });

    await reader({ userId, analysisId });

    expect(failOwnedStuckAnalysis).not.toHaveBeenCalled();
  });

  it("returns the winner's state when a concurrent transition wins", async () => {
    const completed = {
      ...analyzing,
      status: "COMPLETED" as const,
      errorCode: null,
    };
    const { failOwnedStuckAnalysis, findOwnedAnalysis, reader } = setup({
      failed: null,
      concurrent: completed,
    });

    await expect(reader({ userId, analysisId })).resolves.toEqual({
      analysisId,
      status: "COMPLETED",
      errorCode: null,
    });
    expect(failOwnedStuckAnalysis).toHaveBeenCalledOnce();
    expect(findOwnedAnalysis).toHaveBeenCalledTimes(2);
  });

  it("does not attempt recovery when the owned analysis is absent", async () => {
    const { failOwnedStuckAnalysis, reader } = setup({ first: null });

    await expect(reader({ userId, analysisId })).resolves.toBeNull();
    expect(failOwnedStuckAnalysis).not.toHaveBeenCalled();
  });
});
