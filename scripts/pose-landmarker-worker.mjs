import {
  FilesetResolver,
  PoseLandmarker,
} from "/mediapipe/vision_bundle.mjs";

let poseLandmarker = null;

function serializeLandmarks(landmarks) {
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

async function initialize(config) {
  poseLandmarker?.close();
  poseLandmarker = null;

  const startedAt = performance.now();
  const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm", true);
  const modelResponse = await fetch("/mediapipe/model");
  if (!modelResponse.ok) {
    throw new Error(`Pose model download failed: ${modelResponse.status}`);
  }
  const modelAssetBuffer = new Uint8Array(await modelResponse.arrayBuffer());

  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetBuffer,
      delegate: config.delegate,
    },
    runningMode: "VIDEO",
    numPoses: config.numPoses,
    minPoseDetectionConfidence: config.detectionConfidence,
    minPosePresenceConfidence: config.presenceConfidence,
    minTrackingConfidence: config.trackingConfidence,
    outputSegmentationMasks: false,
  });

  return { initializationMs: performance.now() - startedAt };
}

function detect(bitmap, timestampMs) {
  if (!poseLandmarker) throw new Error("Pose Landmarker is not initialized.");
  const startedAt = performance.now();
  try {
    const result = poseLandmarker.detectForVideo(bitmap, timestampMs);
    return {
      inferenceMs: performance.now() - startedAt,
      landmarks: serializeLandmarks(result.landmarks)[0] ?? null,
      worldLandmarks: serializeLandmarks(result.worldLandmarks)[0] ?? null,
    };
  } finally {
    bitmap.close();
  }
}

self.addEventListener("message", async (event) => {
  const { id, type } = event.data;
  try {
    let result;
    if (type === "initialize") {
      result = await initialize(event.data.config);
    } else if (type === "detect") {
      result = detect(event.data.bitmap, event.data.timestampMs);
    } else if (type === "close") {
      poseLandmarker?.close();
      poseLandmarker = null;
      result = null;
    } else {
      throw new Error(`Unknown worker message: ${type}`);
    }
    self.postMessage({ id, result });
  } catch (error) {
    if (event.data.bitmap) event.data.bitmap.close();
    self.postMessage({
      id,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
});
