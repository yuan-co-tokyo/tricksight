// Diagnostic-only raw landmarks. Never imported by the product application.
import { FilesetResolver, PoseLandmarker } from "/mediapipe/vision_bundle.mjs";
import { POSE_LANDMARKER_CONFIG as config } from "/pose/config";
let landmarker;
self.onmessage = async ({ data: { id, type, bitmap, timestampMs } }) => {
  try {
    let result;
    if (type === "initialize") {
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm", true);
      if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvasが必要です");
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "/mediapipe/model", delegate: config.delegate },
        canvas: new OffscreenCanvas(1, 1),
        runningMode: "VIDEO",
        numPoses: config.numPoses,
        minPoseDetectionConfidence: config.confidenceThresholds.detection,
        minPosePresenceConfidence: config.confidenceThresholds.presence,
        minTrackingConfidence: config.confidenceThresholds.tracking,
        outputSegmentationMasks: false,
      });
      result = { connections: PoseLandmarker.POSE_CONNECTIONS };
    } else if (type === "detect") {
      const start = performance.now();
      const detected = landmarker.detectForVideo(bitmap, timestampMs);
      result = { timestampMs, inferenceMs: performance.now() - start,
        landmarks: detected.landmarks[0] ?? null, worldLandmarks: detected.worldLandmarks[0] ?? null };
    } else {
      landmarker?.close();
      landmarker = null;
      result = null;
    }
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  } finally {
    bitmap?.close();
  }
};
