import {
  FilesetResolver,
  PoseLandmarker,
} from "/mediapipe/vision_bundle.mjs";

let landmarker = null;

async function initialize() {
  landmarker?.close();
  landmarker = null;

  const startedAt = performance.now();
  const [vision, modelResponse] = await Promise.all([
    FilesetResolver.forVisionTasks("/mediapipe/wasm", true),
    fetch("/mediapipe/model"),
  ]);
  if (!modelResponse.ok) {
    throw new Error(`Pose model download failed: ${modelResponse.status}`);
  }
  const modelAssetBuffer = new Uint8Array(await modelResponse.arrayBuffer());
  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetBuffer, delegate: "CPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
  return { initializationMs: performance.now() - startedAt };
}

function detect(bitmap, timestampMs) {
  if (!landmarker) throw new Error("Pose Landmarker is not initialized.");
  const startedAt = performance.now();
  try {
    const result = landmarker.detectForVideo(bitmap, timestampMs);
    return {
      inferenceMs: performance.now() - startedAt,
      poseCount: result.landmarks.length,
    };
  } finally {
    bitmap.close();
  }
}

self.addEventListener("message", (event) => {
  const { id, type } = event.data;
  void (async () => {
    if (type === "initialize") return initialize();
    if (type === "detect") {
      return detect(event.data.bitmap, event.data.timestampMs);
    }
    if (type === "close") {
      landmarker?.close();
      landmarker = null;
      return { closed: true };
    }
    throw new Error(`Unknown Worker message: ${type}`);
  })()
    .then((result) => self.postMessage({ id, result }))
    .catch((error) => {
      if (event.data.bitmap) {
        try {
          event.data.bitmap.close();
        } catch {
          // A successful transfer can already have detached the bitmap.
        }
      }
      self.postMessage({
        id,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    });
});
