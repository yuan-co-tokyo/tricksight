import { describe, expect, it } from "vitest";

import {
  DEFAULT_POSE_ASSET_URLS,
  POSE_LANDMARKER_CONFIG,
  POSE_MEASUREMENT_METADATA,
} from "./config";

describe("POSE_LANDMARKER_CONFIG", () => {
  it("比較可能性に必要な推論条件を一か所で固定する", () => {
    expect(POSE_LANDMARKER_CONFIG).toMatchObject({
      algorithmVersion: "pose-landmarker-v1",
      tasksVisionVersion: "1.0.1",
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
      model: {
        name: "pose_landmarker_full-float16-v1",
        sha256:
          "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1",
      },
      visionBundleUrl:
        "/pose-assets/tasks-vision-1.0.1/vision_bundle.mjs",
      wasmBaseUrl: "/pose-assets/tasks-vision-1.0.1/wasm",
    });
    expect(POSE_MEASUREMENT_METADATA).toEqual({
      algorithmVersion: "pose-landmarker-v1",
      tasksVisionVersion: "1.0.1",
      modelName: "pose_landmarker_full-float16-v1",
      modelSha256:
        "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1",
      sampleRateFps: 10,
      delegate: "CPU",
    });
    expect(DEFAULT_POSE_ASSET_URLS).toMatchObject({
      visionBundleUrl:
        "/pose-assets/tasks-vision-1.0.1/vision_bundle.mjs",
      wasmBaseUrl: "/pose-assets/tasks-vision-1.0.1/wasm",
      wasmLoaderMode: "CLASSIC",
    });
  });
});
