import type { PoseMeasurementMetadata } from "./types";

export const POSE_LANDMARKER_CONFIG = {
  algorithmVersion: "pose-landmarker-v1",
  tasksVisionVersion: "1.0.1",
  model: {
    name: "pose_landmarker_full-float16-v1",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
    sha256: "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1",
  },
  visionBundleUrl:
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs",
  wasmBaseUrl:
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm",
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
};

export const DEFAULT_POSE_ASSET_URLS: PoseAssetUrls = {
  modelUrl: POSE_LANDMARKER_CONFIG.model.url,
  visionBundleUrl: POSE_LANDMARKER_CONFIG.visionBundleUrl,
  wasmBaseUrl: POSE_LANDMARKER_CONFIG.wasmBaseUrl,
};

export const POSE_MEASUREMENT_METADATA: PoseMeasurementMetadata = {
  algorithmVersion: POSE_LANDMARKER_CONFIG.algorithmVersion,
  tasksVisionVersion: POSE_LANDMARKER_CONFIG.tasksVisionVersion,
  modelName: POSE_LANDMARKER_CONFIG.model.name,
  modelSha256: POSE_LANDMARKER_CONFIG.model.sha256,
  sampleRateFps: POSE_LANDMARKER_CONFIG.sampleRateFps,
  delegate: POSE_LANDMARKER_CONFIG.delegate,
};
