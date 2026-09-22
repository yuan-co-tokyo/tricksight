import { POSE_LANDMARKER_CONFIG } from "./config";
import {
  calculatePoseMetrics,
  type PoseFrame,
  type PoseLandmark,
  type PoseRun,
} from "./metrics";
import { createPoseMeasurement } from "./measurement";
import type { PoseWorkerRequest, PoseWorkerResponse } from "./protocol";
import type { PoseFailureCode } from "./types";

type LandmarkerResult = {
  landmarks: PoseLandmark[][];
  worldLandmarks: PoseLandmark[][];
};

type PoseLandmarkerInstance = {
  detectForVideo(bitmap: ImageBitmap, timestampMs: number): LandmarkerResult;
  close(): void;
};

type VisionModule = {
  FilesetResolver: {
    forVisionTasks(baseUrl: string, useModule: boolean): Promise<unknown>;
  };
  PoseLandmarker: {
    createFromOptions(
      vision: unknown,
      options: {
        baseOptions: { modelAssetBuffer: Uint8Array; delegate: "CPU" };
        canvas: OffscreenCanvas;
        runningMode: "VIDEO";
        numPoses: number;
        minPoseDetectionConfidence: number;
        minPosePresenceConfidence: number;
        minTrackingConfidence: number;
        outputSegmentationMasks: false;
      },
    ): Promise<PoseLandmarkerInstance>;
  };
};

let poseLandmarker: PoseLandmarkerInstance | null = null;
let frames: PoseFrame[] = [];
let analysisStartedAt = 0;
let initializationMs = 0;

class PoseWorkerFailure extends Error {
  constructor(
    readonly code: PoseFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "PoseWorkerFailure";
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function workerFailure(
  code: PoseFailureCode,
  context: string,
  error: unknown,
) {
  return new PoseWorkerFailure(code, `${context}: ${errorMessage(error)}`);
}

function serializeLandmarks(landmarks: PoseLandmark[][]) {
  return landmarks.map((pose) =>
    pose.map(({ x, y, z, visibility, presence }) => ({
      x,
      y,
      z,
      visibility,
      presence,
    })),
  );
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function initialize(request: Extract<PoseWorkerRequest, { type: "initialize" }>) {
  poseLandmarker?.close();
  poseLandmarker = null;
  frames = [];
  analysisStartedAt = performance.now();
  if (typeof OffscreenCanvas === "undefined") {
    throw new PoseWorkerFailure(
      "OFFSCREEN_CANVAS_UNAVAILABLE",
      "OffscreenCanvas is unavailable; optional pose measurement was skipped to keep upload and AI analysis responsive.",
    );
  }

  const startedAt = performance.now();
  const [visionModuleResult, modelResponseResult] = await Promise.allSettled([
    import(/* webpackIgnore: true */ request.assetUrls.visionBundleUrl) as Promise<VisionModule>,
    fetch(request.assetUrls.modelUrl),
  ]);
  if (visionModuleResult.status === "rejected") {
    throw workerFailure(
      "VISION_BUNDLE_LOAD_FAILED",
      "Vision bundle load failed",
      visionModuleResult.reason,
    );
  }
  if (modelResponseResult.status === "rejected") {
    throw workerFailure(
      "MODEL_DOWNLOAD_FAILED",
      "Pose model download failed",
      modelResponseResult.reason,
    );
  }
  const visionModule = visionModuleResult.value;
  const modelResponse = modelResponseResult.value;
  if (!modelResponse.ok) {
    throw new PoseWorkerFailure(
      "MODEL_DOWNLOAD_FAILED",
      `Pose model download failed: ${modelResponse.status}`,
    );
  }
  const modelBuffer = await modelResponse.arrayBuffer();
  let modelSha256: string;
  try {
    modelSha256 = toHex(
      await crypto.subtle.digest("SHA-256", modelBuffer),
    );
  } catch (error) {
    throw workerFailure(
      "MODEL_HASH_CHECK_FAILED",
      "Pose model hash check failed",
      error,
    );
  }
  if (modelSha256 !== POSE_LANDMARKER_CONFIG.model.sha256) {
    throw new PoseWorkerFailure(
      "MODEL_HASH_MISMATCH",
      `Pose model hash mismatch: expected ${POSE_LANDMARKER_CONFIG.model.sha256}, received ${modelSha256}.`,
    );
  }

  let vision: unknown;
  try {
    vision = await visionModule.FilesetResolver.forVisionTasks(
      request.assetUrls.wasmBaseUrl,
      // Turbopack currently emits a classic Worker bootstrap even though the
      // Worker constructor requests type=module. Selecting MediaPipe's ES
      // module loader here would execute import.meta through importScripts and
      // fail before inference. The classic loader still detects SIMD itself.
      request.assetUrls.wasmLoaderMode === "MODULE",
    );
  } catch (error) {
    throw workerFailure(
      "WASM_INITIALIZATION_FAILED",
      "MediaPipe WASM initialization failed",
      error,
    );
  }
  const thresholds = POSE_LANDMARKER_CONFIG.confidenceThresholds;
  try {
    poseLandmarker = await visionModule.PoseLandmarker.createFromOptions(
      vision,
      {
        baseOptions: {
          modelAssetBuffer: new Uint8Array(modelBuffer),
          delegate: POSE_LANDMARKER_CONFIG.delegate,
        },
        // MediaPipe 1.0.1 misclassifies CriOS because its UA has Safari but no
        // Version/ token, then tries document.createElement inside the Worker.
        // Passing the native canvas bypasses that heuristic through its public
        // option while keeping all inference off the main thread.
        canvas: new OffscreenCanvas(1, 1),
        runningMode: "VIDEO",
        numPoses: POSE_LANDMARKER_CONFIG.numPoses,
        minPoseDetectionConfidence: thresholds.detection,
        minPosePresenceConfidence: thresholds.presence,
        minTrackingConfidence: thresholds.tracking,
        outputSegmentationMasks: false,
      },
    );
  } catch (error) {
    throw workerFailure(
      "LANDMARKER_INITIALIZATION_FAILED",
      "Pose Landmarker initialization failed",
      error,
    );
  }
  initializationMs = performance.now() - startedAt;

  return { type: "initialized" as const, initializationMs };
}

function detect(request: Extract<PoseWorkerRequest, { type: "detect" }>) {
  const startedAt = performance.now();
  try {
    if (!poseLandmarker) {
      throw new Error("Pose Landmarker is not initialized.");
    }
    let result: LandmarkerResult;
    try {
      result = poseLandmarker.detectForVideo(
        request.bitmap,
        request.timestampMs,
      );
    } catch (error) {
      throw workerFailure(
        "POSE_INFERENCE_FAILED",
        "Pose inference failed",
        error,
      );
    }
    const inferenceMs = performance.now() - startedAt;
    frames.push({
      timestampMs: request.timestampMs,
      inferenceMs,
      landmarks: serializeLandmarks(result.landmarks)[0] ?? null,
      worldLandmarks: serializeLandmarks(result.worldLandmarks)[0] ?? null,
    });

    // Only aggregate progress leaves the Worker. Raw 33-point landmarks stay
    // in this module until finish() clears them.
    return {
      type: "progress" as const,
      processedFrames: frames.length,
      inferenceMs,
    };
  } finally {
    request.bitmap.close();
  }
}

function finish(request: Extract<PoseWorkerRequest, { type: "finish" }>) {
  try {
    const run: PoseRun = {
      mode: "fixed",
      fixedFps: POSE_LANDMARKER_CONFIG.sampleRateFps,
      durationMs: request.durationMs,
      videoWidth: request.videoWidth,
      videoHeight: request.videoHeight,
      initializationMs,
      processingMs: performance.now() - analysisStartedAt,
      presentedFrameGaps: 0,
      frames,
    };
    const calculated = calculatePoseMetrics(run);
    const processingDurationMs = performance.now() - analysisStartedAt;
    const measurement = createPoseMeasurement(calculated, processingDurationMs);

    // Discard raw landmarks before the terminal aggregate crosses the Worker
    // boundary. No product message type exposes them.
    frames = [];
    return { type: "finished" as const, measurement };
  } catch (error) {
    throw workerFailure(
      "POSE_FINALIZATION_FAILED",
      "Pose metric finalization failed",
      error,
    );
  }
}

function close() {
  poseLandmarker?.close();
  poseLandmarker = null;
  frames = [];
  return { type: "closed" as const };
}

self.addEventListener("message", (event: MessageEvent<PoseWorkerRequest>) => {
  const request = event.data;
  void (async () => {
    let result;
    if (request.type === "initialize") result = await initialize(request);
    else if (request.type === "detect") result = detect(request);
    else if (request.type === "finish") result = finish(request);
    else result = close();

    self.postMessage({ id: request.id, result } satisfies PoseWorkerResponse);
  })().catch((error) => {
    const fallbackCodes = {
      initialize: "LANDMARKER_INITIALIZATION_FAILED",
      detect: "POSE_INFERENCE_FAILED",
      finish: "POSE_FINALIZATION_FAILED",
      close: "POSE_WORKER_CLOSE_FAILED",
    } as const satisfies Record<PoseWorkerRequest["type"], PoseFailureCode>;
    self.postMessage({
      id: request.id,
      error: {
        code:
          error instanceof PoseWorkerFailure
            ? error.code
            : fallbackCodes[request.type],
        message:
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
      },
    } satisfies PoseWorkerResponse);
  });
});
