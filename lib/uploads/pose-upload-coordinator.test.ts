import { describe, expect, it, vi } from "vitest";

import { POSE_MEASUREMENT_METADATA } from "../pose/config";
import type {
  PoseAnalysisTask,
  PoseMeasurementResult,
} from "../pose/types";
import {
  createPoseSelectionCoordinator,
  startIndependentPostUploadTasks,
} from "./pose-upload-coordinator";

function terminalResult(
  status: PoseMeasurementResult["status"],
): PoseMeasurementResult {
  if (status === "COMPLETED") {
    return {
      status,
      metadata: POSE_MEASUREMENT_METADATA,
      quality: {
        frameCount: 10,
        poseFrameCount: 10,
        lowerBodyFrameCount: 10,
        poseCoverage: 1,
        lowerBodyCoverage: 1,
        reasons: [],
      },
      metrics: {
        minimumMeanKneeAngleDeg: 70,
        kneeExtensionRangeDeg: 50,
        hipVerticalRangeTorsoUnits: 0.8,
        landingTrunkTiltDeg: null,
      },
      processingDurationMs: 1_000,
    };
  }
  if (status === "UNASSESSABLE") {
    return {
      status,
      metadata: POSE_MEASUREMENT_METADATA,
      quality: {
        frameCount: 10,
        poseFrameCount: 7,
        lowerBodyFrameCount: 6,
        poseCoverage: 0.7,
        lowerBodyCoverage: 0.6,
        reasons: [
          "POSE_COVERAGE_BELOW_THRESHOLD",
          "LOWER_BODY_COVERAGE_BELOW_THRESHOLD",
        ],
      },
      metrics: null,
      processingDurationMs: 1_000,
    };
  }
  if (status === "FAILED") {
    return {
      status,
      metadata: POSE_MEASUREMENT_METADATA,
      quality: null,
      metrics: null,
      errorCode: "MODEL_LOAD_FAILED",
      processingDurationMs: 1_000,
    };
  }
  return {
    status,
    metadata: POSE_MEASUREMENT_METADATA,
    quality: null,
    metrics: null,
    processingDurationMs: 1_000,
  };
}

describe("post-upload independence", () => {
  it.each([
    "COMPLETED",
    "UNASSESSABLE",
    "FAILED",
    "TIMED_OUT",
    "CANCELED",
  ] as const)("starts LLM analysis for pose terminal status %s", async (status) => {
    const startAnalysis = vi.fn().mockResolvedValue({ analysisId: "analysis" });
    const savePoseMeasurement = vi.fn().mockResolvedValue({
      outcome: "CREATED",
    });

    const tasks = startIndependentPostUploadTasks({
      videoId: "video-id",
      runtimeFamily: "CHROMIUM",
      poseResult: Promise.resolve(terminalResult(status)),
      startAnalysis,
      savePoseMeasurement,
    });

    expect(startAnalysis).toHaveBeenCalledWith("video-id");
    await expect(tasks.analysisStart).resolves.toEqual({
      analysisId: "analysis",
    });
    await expect(tasks.posePersistence).resolves.toMatchObject({
      status: "SAVED",
    });
    expect(savePoseMeasurement).toHaveBeenCalledWith(
      expect.objectContaining({
        videoId: "video-id",
        measurement: expect.objectContaining({ status }),
      }),
    );
  });

  it("keeps LLM analysis successful when pose persistence fails", async () => {
    const startAnalysis = vi.fn().mockResolvedValue({ analysisId: "analysis" });
    const saveError = new Error("pose API unavailable");

    const tasks = startIndependentPostUploadTasks({
      videoId: "video-id",
      runtimeFamily: "WEBKIT",
      poseResult: Promise.resolve(terminalResult("FAILED")),
      startAnalysis,
      savePoseMeasurement: vi.fn().mockRejectedValue(saveError),
    });

    await expect(tasks.analysisStart).resolves.toEqual({
      analysisId: "analysis",
    });
    await expect(tasks.posePersistence).resolves.toEqual({
      status: "FAILED",
      error: saveError,
    });
  });

  it("starts LLM analysis without waiting for a pending pose result", () => {
    const poseResult = new Promise<PoseMeasurementResult>(() => {});
    const startAnalysis = vi.fn().mockResolvedValue({ analysisId: "analysis" });

    startIndependentPostUploadTasks({
      videoId: "video-id",
      runtimeFamily: "CHROMIUM",
      poseResult,
      startAnalysis,
      savePoseMeasurement: vi.fn(),
    });

    expect(startAnalysis).toHaveBeenCalledOnce();
  });
});

describe("pose selection coordinator", () => {
  it("cancels the old task and discards its late progress/result", async () => {
    const resolvers: Array<(result: PoseMeasurementResult) => void> = [];
    const tasks: Array<PoseAnalysisTask & { cancel: ReturnType<typeof vi.fn> }> = [];
    const start = vi.fn((_video, options) => {
      let resolve!: (result: PoseMeasurementResult) => void;
      const task = {
        result: new Promise<PoseMeasurementResult>((done) => {
          resolve = done;
        }),
        cancel: vi.fn(),
      };
      resolvers.push(resolve);
      tasks.push(task);
      options.onProgress({
        phase: "INITIALIZING",
        processedFrames: 0,
        totalFrames: 10,
        percent: 0,
      });
      return task;
    });
    const coordinator = createPoseSelectionCoordinator(start, 120_000);
    const firstTerminal = vi.fn();
    const secondTerminal = vi.fn();
    const first = coordinator.select(new Blob(["first"]), {
      onProgress: vi.fn(),
      onTerminal: firstTerminal,
    });
    const second = coordinator.select(new Blob(["second"]), {
      onProgress: vi.fn(),
      onTerminal: secondTerminal,
    });

    expect(tasks[0]?.cancel).toHaveBeenCalledOnce();
    resolvers[0]?.(terminalResult("CANCELED"));
    resolvers[1]?.(terminalResult("COMPLETED"));
    await Promise.all([first.result, second.result]);

    expect(firstTerminal).not.toHaveBeenCalled();
    expect(secondTerminal).toHaveBeenCalledWith(terminalResult("COMPLETED"));
    expect(start.mock.calls[0]?.[1].timeoutMs).toBe(120_000);
  });

  it("cancels the active task on explicit cancel and dispose", () => {
    const cancel = vi.fn();
    const start = vi.fn(
      () =>
        ({
          result: new Promise<PoseMeasurementResult>(() => {}),
          cancel,
        }) satisfies PoseAnalysisTask,
    );
    const coordinator = createPoseSelectionCoordinator(start);
    const handle = coordinator.select(new Blob(), {
      onProgress: vi.fn(),
      onTerminal: vi.fn(),
    });

    handle.cancel();
    coordinator.dispose();

    expect(cancel).toHaveBeenCalledTimes(2);
  });
});
