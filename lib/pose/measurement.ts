import { POSE_MEASUREMENT_METADATA } from "./config";
import { assessPoseQuality, type PoseMetrics } from "./metrics";
import type { PoseMeasurementResult } from "./types";

export function createPoseMeasurement(
  calculated: PoseMetrics,
  processingDurationMs: number,
): PoseMeasurementResult {
  const assessment = assessPoseQuality(calculated);
  const quality = {
    frameCount: calculated.frameCount,
    poseFrameCount: calculated.poseFrameCount,
    lowerBodyFrameCount: calculated.lowerBodyFrameCount,
    poseCoverage: calculated.poseCoverage,
    lowerBodyCoverage: calculated.lowerBodyCoverage,
    reasons: assessment.reasons,
  };

  if (assessment.status === "UNASSESSABLE") {
    return {
      status: "UNASSESSABLE",
      metadata: POSE_MEASUREMENT_METADATA,
      quality,
      metrics: null,
      processingDurationMs,
    };
  }

  return {
    status: "COMPLETED",
    metadata: POSE_MEASUREMENT_METADATA,
    quality,
    metrics: {
      minimumMeanKneeAngleDeg: calculated.minimumMeanKneeAngleDeg,
      // T11-1 found a distribution difference, so retain this for later
      // evaluation. T11-6 keeps the initial UI focused on two metrics.
      kneeExtensionRangeDeg: calculated.kneeExtensionRangeDeg,
      hipVerticalRangeTorsoUnits: calculated.hipRiseTorsoUnits,
      // The observed direction contradicted the hypothesis, so persist for
      // future evaluation but do not display it in the MVP UI.
      landingTrunkTiltDeg: calculated.landingTrunkTiltDeg,
    },
    processingDurationMs,
  };
}
