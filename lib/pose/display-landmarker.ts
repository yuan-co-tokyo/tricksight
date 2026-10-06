import { POSE_LANDMARKER_CONFIG, type PoseAssetUrls } from "./config";
import type { PoseLandmark } from "./metrics";
export type DisplayLandmarker = {
  detectForVideo(bitmap: ImageBitmap, timestampMs: number): { landmarks: PoseLandmark[][]; worldLandmarks: PoseLandmark[][] };
  close(): void;
};
export async function createDisplayLandmarker(assets: PoseAssetUrls): Promise<DisplayLandmarker> {
  const [vision, response] = await Promise.all([
    import(/* webpackIgnore: true */ assets.visionBundleUrl), fetch(assets.modelUrl),
  ]);
  if (!response.ok) throw new Error("Model unavailable");
  const buffer = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const hash = Array.from(new Uint8Array(digest), b=>b.toString(16).padStart(2,"0")).join("");
  if (hash !== POSE_LANDMARKER_CONFIG.model.sha256) throw new Error("Model mismatch");
  const files = await vision.FilesetResolver.forVisionTasks(assets.wasmBaseUrl, assets.wasmLoaderMode === "MODULE");
  const thresholds = POSE_LANDMARKER_CONFIG.confidenceThresholds;
  return vision.PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetBuffer: new Uint8Array(buffer), delegate: POSE_LANDMARKER_CONFIG.delegate },
    canvas: new OffscreenCanvas(1,1), runningMode:"VIDEO", numPoses:POSE_LANDMARKER_CONFIG.numPoses,
    minPoseDetectionConfidence:thresholds.detection, minPosePresenceConfidence:thresholds.presence,
    minTrackingConfidence:thresholds.tracking, outputSegmentationMasks:false,
  });
}
