import { POSE_LANDMARKER_CONFIG } from "./config";
import {
  calculatePoseMetrics,
  type PoseFrame,
  type PoseLandmark,
  type PoseRun,
} from "./metrics";
import { createPoseMeasurement } from "./measurement";
import type { PoseWorkerRequest, PoseWorkerResponse } from "./protocol";

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
    forVisionTasks(baseUrl: string, useSimd: boolean): Promise<unknown>;
  };
  PoseLandmarker: {
    createFromOptions(
      vision: unknown,
      options: {
        baseOptions: { modelAssetBuffer: Uint8Array; delegate: "CPU" };
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

  const startedAt = performance.now();
  const [visionModule, modelResponse] = await Promise.all([
    import(/* webpackIgnore: true */ request.assetUrls.visionBundleUrl) as Promise<VisionModule>,
    fetch(request.assetUrls.modelUrl),
  ]);
  if (!modelResponse.ok) {
    throw new Error(`Pose model download failed: ${modelResponse.status}`);
  }
  const modelBuffer = await modelResponse.arrayBuffer();
  const modelSha256 = toHex(await crypto.subtle.digest("SHA-256", modelBuffer));
  if (modelSha256 !== POSE_LANDMARKER_CONFIG.model.sha256) {
    throw new Error(
      `Pose model hash mismatch: expected ${POSE_LANDMARKER_CONFIG.model.sha256}, received ${modelSha256}.`,
    );
  }

  const vision = await visionModule.FilesetResolver.forVisionTasks(
    request.assetUrls.wasmBaseUrl,
    true,
  );
  const thresholds = POSE_LANDMARKER_CONFIG.confidenceThresholds;
  poseLandmarker = await visionModule.PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetBuffer: new Uint8Array(modelBuffer),
      delegate: POSE_LANDMARKER_CONFIG.delegate,
    },
    runningMode: "VIDEO",
    numPoses: POSE_LANDMARKER_CONFIG.numPoses,
    minPoseDetectionConfidence: thresholds.detection,
    minPosePresenceConfidence: thresholds.presence,
    minTrackingConfidence: thresholds.tracking,
    outputSegmentationMasks: false,
  });
  initializationMs = performance.now() - startedAt;

  return { type: "initialized" as const, initializationMs };
}

function detect(request: Extract<PoseWorkerRequest, { type: "detect" }>) {
  const startedAt = performance.now();
  try {
    if (!poseLandmarker) {
      throw new Error("Pose Landmarker is not initialized.");
    }
    const result = poseLandmarker.detectForVideo(
      request.bitmap,
      request.timestampMs,
    );
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
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    } satisfies PoseWorkerResponse);
  });
});
