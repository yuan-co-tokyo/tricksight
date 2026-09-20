import { afterEach, describe, expect, it, vi } from "vitest";

import { POSE_MEASUREMENT_METADATA } from "./config";
import {
  poseAnalysisTesting,
  type FrameSource,
  type InternalDependencies,
  type WorkerLike,
} from "./browser-analysis";
import type { PoseWorkerRequest, PoseWorkerResponse } from "./protocol";

class FakeWorker extends EventTarget {
  terminated = false;
  detectedFrames = 0;

  postMessage(message: PoseWorkerRequest) {
    queueMicrotask(() => {
      if (this.terminated) return;
      let result: Extract<PoseWorkerResponse, { result: unknown }>["result"];
      if (message.type === "initialize") {
        result = { type: "initialized", initializationMs: 10 };
      } else if (message.type === "detect") {
        this.detectedFrames += 1;
        message.bitmap.close();
        result = {
          type: "progress",
          processedFrames: this.detectedFrames,
          inferenceMs: 5,
        };
      } else if (message.type === "finish") {
        result = {
          type: "finished",
          measurement: {
            status: "COMPLETED",
            metadata: POSE_MEASUREMENT_METADATA,
            quality: {
              frameCount: this.detectedFrames,
              poseFrameCount: this.detectedFrames,
              lowerBodyFrameCount: this.detectedFrames,
              poseCoverage: 1,
              lowerBodyCoverage: 1,
              reasons: [],
            },
            metrics: {
              minimumMeanKneeAngleDeg: 70,
              kneeExtensionRangeDeg: 60,
              hipVerticalRangeTorsoUnits: 0.5,
              landingTrunkTiltDeg: 8,
            },
            processingDurationMs: 50,
          },
        };
      } else {
        result = { type: "closed" };
      }
      this.dispatchEvent(
        new MessageEvent("message", {
          data: { id: message.id, result } satisfies PoseWorkerResponse,
        }),
      );
    });
  }

  terminate() {
    this.terminated = true;
  }
}

function bitmap() {
  return { close: vi.fn() } as unknown as ImageBitmap;
}

function frameSource(overrides: Partial<FrameSource> = {}): FrameSource {
  return {
    durationMs: 550,
    videoWidth: 1_920,
    videoHeight: 1_080,
    frameAt: vi.fn(async () => bitmap()),
    close: vi.fn(),
    ...overrides,
  };
}

function dependencies(
  source: FrameSource,
  worker = new FakeWorker(),
): InternalDependencies {
  let now = 0;
  return {
    createWorker: () => worker as unknown as WorkerLike,
    createFrameSource: async () => source,
    now: () => (now += 10),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("startPoseVideoAnalysis core", () => {
  it("固定10fpsで処理し、進捗と集約4指標だけを返す", async () => {
    const source = frameSource();
    const progress = vi.fn();
    const task = poseAnalysisTesting.startWithDependencies(
      new Blob(),
      { onProgress: progress },
      dependencies(source),
    );

    const result = await task.result;

    expect(result).toMatchObject({
      status: "COMPLETED",
      metrics: {
        minimumMeanKneeAngleDeg: 70,
        kneeExtensionRangeDeg: 60,
        hipVerticalRangeTorsoUnits: 0.5,
        landingTrunkTiltDeg: 8,
      },
    });
    expect(source.frameAt).toHaveBeenCalledTimes(5);
    expect(progress).toHaveBeenCalledWith({
      phase: "INITIALIZING",
      processedFrames: 0,
      totalFrames: 5,
      percent: 0,
    });
    expect(progress).toHaveBeenCalledWith({
      phase: "FINALIZING",
      processedFrames: 5,
      totalFrames: 5,
      percent: 1,
    });
    expect(JSON.stringify(result)).not.toContain("landmarks");
    expect(source.close).toHaveBeenCalledOnce();
  });

  it("cancelするとWorkerを止めてCANCELEDを返す", async () => {
    const source = frameSource({
      frameAt: (_timestamp, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    });
    const worker = new FakeWorker();
    const task = poseAnalysisTesting.startWithDependencies(
      new Blob(),
      {},
      dependencies(source, worker),
    );
    await Promise.resolve();
    task.cancel();

    await expect(task.result).resolves.toMatchObject({ status: "CANCELED" });
    expect(worker.terminated).toBe(true);
    expect(source.close).toHaveBeenCalledOnce();
  });

  it("absolute timeoutでWorkerを止めてTIMED_OUTを返す", async () => {
    vi.useFakeTimers();
    const source = frameSource({
      frameAt: (_timestamp, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    });
    const worker = new FakeWorker();
    const task = poseAnalysisTesting.startWithDependencies(
      new Blob(),
      { timeoutMs: 20 },
      dependencies(source, worker),
    );
    await vi.advanceTimersByTimeAsync(20);

    await expect(task.result).resolves.toMatchObject({ status: "TIMED_OUT" });
    expect(worker.terminated).toBe(true);
  });

  it("decode失敗を骨格側だけのFAILEDへ閉じ込める", async () => {
    const deps = dependencies(frameSource());
    deps.createFrameSource = async () => {
      throw new DOMException("decode failed", "NotSupportedError");
    };
    const result = await poseAnalysisTesting.startWithDependencies(
      new Blob(),
      {},
      deps,
    ).result;

    expect(result).toMatchObject({
      status: "FAILED",
      errorCode: "NOTSUPPORTEDERROR",
      metrics: null,
    });
  });
});
