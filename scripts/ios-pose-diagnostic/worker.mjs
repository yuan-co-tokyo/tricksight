import {
  FilesetResolver,
  PoseLandmarker,
} from "/mediapipe/vision_bundle.mjs";

let landmarker = null;

function mediaPipeEnvironment() {
  const userAgent = navigator.userAgent;
  const isWebKit = userAgent.includes("Safari") && !userAgent.includes("Chrome");
  const safariVersionMatch = userAgent.match(/Version\/([\d]+).*Safari/);
  const safariMajorVersion = safariVersionMatch
    ? Number(safariVersionMatch[1])
    : null;
  const offscreenCanvasAvailable = typeof OffscreenCanvas !== "undefined";
  let offscreenCanvasWebgl2 = false;
  let offscreenCanvasWebgl2Error = null;

  if (offscreenCanvasAvailable) {
    try {
      const probeCanvas = new OffscreenCanvas(1, 1);
      const context = probeCanvas.getContext("webgl2");
      offscreenCanvasWebgl2 = context !== null;
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch (error) {
      offscreenCanvasWebgl2Error =
        error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
  }

  // This mirrors @mediapipe/tasks-vision 1.0.1's supportsOffscreenCanvas
  // check. CriOS is classified as WebKit but its UA replaces Version/ with
  // CriOS/, which makes this false even on iOS versions with native support.
  const mediaPipeSupportsOffscreenCanvas =
    offscreenCanvasAvailable &&
    (!isWebKit || (safariMajorVersion !== null && safariMajorVersion >= 17));

  return {
    userAgent,
    documentAvailable: typeof document !== "undefined",
    offscreenCanvasAvailable,
    offscreenCanvasWebgl2,
    offscreenCanvasWebgl2Error,
    mediaPipeIsWebKit: isWebKit,
    mediaPipeSafariMajorVersion: safariMajorVersion,
    mediaPipeSupportsOffscreenCanvas,
  };
}

async function initialize(canvasMode = "DEFAULT") {
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
  const options = {
    baseOptions: { modelAssetBuffer, delegate: "CPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  };
  if (canvasMode === "EXPLICIT_OFFSCREEN") {
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("OffscreenCanvas is not available in this Worker.");
    }
    options.canvas = new OffscreenCanvas(1, 1);
  } else if (canvasMode !== "DEFAULT") {
    throw new Error(`Unknown canvas mode: ${canvasMode}`);
  }
  landmarker = await PoseLandmarker.createFromOptions(vision, options);
  return {
    initializationMs: performance.now() - startedAt,
    canvasMode,
  };
}

function detect(bitmap, timestampMs) {
  if (!landmarker) throw new Error("Pose Landmarker is not initialized.");
  const startedAt = performance.now();
  try {
    const result = landmarker.detectForVideo(bitmap, timestampMs);
    const poseCount = result.landmarks.length;
    result.close?.();
    return {
      inferenceMs: performance.now() - startedAt,
      poseCount,
    };
  } finally {
    bitmap.close();
  }
}

self.addEventListener("message", (event) => {
  const { id, type } = event.data;
  void (async () => {
    if (type === "environment") return mediaPipeEnvironment();
    if (type === "initialize") return initialize(event.data.canvasMode);
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
