import type { PoseMeasurementMetadata } from "./types";

const TASKS_VISION_VERSION = "1.0.1";
const TASKS_VISION_ASSET_BASE =
  `/pose-assets/tasks-vision-${TASKS_VISION_VERSION}`;

export const POSE_LANDMARKER_CONFIG = {
  algorithmVersion: "pose-landmarker-v1",
  tasksVisionVersion: TASKS_VISION_VERSION,
  model: {
    name: "pose_landmarker_full-float16-v1",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
    sha256: "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1",
  },
  // MediaPipe loads its WASM bootstrap with importScripts inside the Worker.
  // Next.js serves the generated Worker from our origin, so these versioned
  // assets must also be same-origin. Cross-origin CDN paths fail in the real
  // app even though the standalone integration server can mask that gap.
  visionBundleUrl: `${TASKS_VISION_ASSET_BASE}/vision_bundle.mjs`,
  wasmBaseUrl: `${TASKS_VISION_ASSET_BASE}/wasm`,
  sampleRateFps: 10,
  delegate: "CPU",
  numPoses: 1,
  confidenceThresholds: {
    detection: 0.5,
    presence: 0.5,
    tracking: 0.5,
    landmarkVisibility: 0.5,
  },
  qualityThresholds: {
    poseCoverage: 0.8,
    lowerBodyCoverage: 0.8,
  },
  // T11-7 measured 8.2s for 89 frames on a real iPhone (about 1.8x macOS).
  // Keep 120s so slower devices and clips up to 20s retain ample headroom
  // while preserving an absolute resource-cleanup bound.
  defaultTimeoutMs: 120_000,
  progress: {
    frameInterval: 5,
    minimumIntervalMs: 100,
  },
} as const;

export type PoseAssetUrls = {
  modelUrl: string;
  visionBundleUrl: string;
  wasmBaseUrl: string;
  wasmLoaderMode: "CLASSIC" | "MODULE";
};

export const DEFAULT_POSE_ASSET_URLS: PoseAssetUrls = {
  modelUrl: POSE_LANDMARKER_CONFIG.model.url,
  visionBundleUrl: POSE_LANDMARKER_CONFIG.visionBundleUrl,
  wasmBaseUrl: POSE_LANDMARKER_CONFIG.wasmBaseUrl,
  // Next.js/Turbopack emits a classic Worker bootstrap in the product build.
  // Standalone module-worker tests override this explicitly.
  wasmLoaderMode: "CLASSIC",
};

export const POSE_MEASUREMENT_METADATA: PoseMeasurementMetadata = {
  algorithmVersion: POSE_LANDMARKER_CONFIG.algorithmVersion,
  tasksVisionVersion: POSE_LANDMARKER_CONFIG.tasksVisionVersion,
  modelName: POSE_LANDMARKER_CONFIG.model.name,
  modelSha256: POSE_LANDMARKER_CONFIG.model.sha256,
  sampleRateFps: POSE_LANDMARKER_CONFIG.sampleRateFps,
  delegate: POSE_LANDMARKER_CONFIG.delegate,
};
