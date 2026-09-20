import { describe, expect, it } from "vitest";

import type { PoseMetrics } from "./metrics";
import { createPoseMeasurement } from "./measurement";

function metrics(overrides: Partial<PoseMetrics> = {}): PoseMetrics {
  return {
    frameCount: 10,
    poseFrameCount: 10,
    lowerBodyFrameCount: 10,
    detectedApexTimestampMs: 300,
    detectedLandingTimestampMs: 600,
    poseCoverage: 1,
    lowerBodyCoverage: 1,
    meanInferenceMs: 20,
    p95InferenceMs: 22,
    minimumMeanKneeAngleDeg: 70,
    kneeExtensionRangeDeg: 60,
    hipRiseTorsoUnits: 0.5,
    hipRiseDurationMs: 300,
    landingAnkleHeightAsymmetryTorsoUnits: 0.1,
    landingFootSeparationHipWidths: 1.5,
    landingMeanKneeAngleDeg: 90,
    landingKneeAsymmetryDeg: 5,
    landingTrunkTiltDeg: 8,
    postLandingTrunkTiltRangeDeg: 4,
    postLandingHipRangeTorsoUnits: 0.2,
    p95TrunkAngularSpeedDegPerSecond: 10,
    ...overrides,
  };
}

describe("createPoseMeasurement", () => {
  it("品質ゲート通過時だけ4集約指標を返す", () => {
    expect(createPoseMeasurement(metrics(), 1_000)).toMatchObject({
      status: "COMPLETED",
      metrics: {
        minimumMeanKneeAngleDeg: 70,
        kneeExtensionRangeDeg: 60,
        hipVerticalRangeTorsoUnits: 0.5,
        landingTrunkTiltDeg: 8,
      },
      processingDurationMs: 1_000,
    });
  });

  it("品質ゲート未達では集約値をWorker外へ出さない", () => {
    expect(
      createPoseMeasurement(
        metrics({
          poseFrameCount: 7,
          lowerBodyFrameCount: 6,
          poseCoverage: 0.7,
          lowerBodyCoverage: 0.6,
        }),
        1_000,
      ),
    ).toMatchObject({
      status: "UNASSESSABLE",
      metrics: null,
      quality: {
        reasons: [
          "POSE_COVERAGE_BELOW_THRESHOLD",
          "LOWER_BODY_COVERAGE_BELOW_THRESHOLD",
        ],
      },
    });
  });
});
