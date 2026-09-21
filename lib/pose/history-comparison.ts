export type PoseComparisonUnavailableReason =
  | "NO_SAME_TRICK_MEASUREMENT"
  | "VIDEO_SPEED"
  | "CAMERA_ANGLE"
  | "PROCESS_OR_RUNTIME";

export type DisplayedPoseMetrics = {
  minimumMeanKneeAngleDeg: number;
  hipVerticalRangeTorsoUnits: number;
};

export type PoseComparisonCandidate = DisplayedPoseMetrics & {
  sessionId: string;
  practicedAt: Date;
  videoSpeed: "NORMAL" | "SLOW_MOTION" | null;
  cameraAngle: "SIDE" | "FRONT" | "REAR" | "DIAGONAL";
  algorithmVersion: string;
  modelSha256: string;
  sampleRateFps: number;
  delegate: string;
  runtimeFamily: string;
};

export type CurrentPoseComparisonConditions = Omit<
  PoseComparisonCandidate,
  "sessionId" | "practicedAt" | keyof DisplayedPoseMetrics
>;

export type PoseMeasurementForHistory = {
  status:
    | "COMPLETED"
    | "UNASSESSABLE"
    | "FAILED"
    | "TIMED_OUT"
    | "CANCELED";
  qualityReasons: string[];
  minimumMeanKneeAngleDeg: number | null;
  hipVerticalRangeTorsoUnits: number | null;
};

export type PoseHistoryComparisonState =
  | {
      kind: "comparison";
      current: DisplayedPoseMetrics;
      previous: PoseComparisonCandidate;
    }
  | {
      kind: "baseline";
      current: DisplayedPoseMetrics;
      reason: PoseComparisonUnavailableReason;
      currentVideoSpeed: CurrentPoseComparisonConditions["videoSpeed"];
      currentCameraAngle: CurrentPoseComparisonConditions["cameraAngle"];
    }
  | {
      kind: "unassessable";
      status: PoseMeasurementForHistory["status"] | "MISSING";
      qualityReasons: string[];
    };

export const POSE_COMPARISON_THRESHOLDS = {
  kneeAngleDeg: 2,
  hipVerticalRangeTorsoUnits: 0.02,
} as const;

export function hasMatchingPoseComparisonConditions(
  current: CurrentPoseComparisonConditions,
  candidate: PoseComparisonCandidate,
) {
  return (
    current.videoSpeed !== null &&
    candidate.videoSpeed === current.videoSpeed &&
    candidate.cameraAngle === current.cameraAngle &&
    candidate.algorithmVersion === current.algorithmVersion &&
    candidate.modelSha256 === current.modelSha256 &&
    candidate.sampleRateFps === current.sampleRateFps &&
    candidate.delegate === current.delegate &&
    candidate.runtimeFamily === current.runtimeFamily
  );
}

export function resolvePoseComparisonUnavailableReason(
  current: CurrentPoseComparisonConditions,
  candidate: PoseComparisonCandidate | null,
): PoseComparisonUnavailableReason {
  if (!candidate) return "NO_SAME_TRICK_MEASUREMENT";
  if (
    current.videoSpeed === null ||
    candidate.videoSpeed !== current.videoSpeed
  ) {
    return "VIDEO_SPEED";
  }
  if (candidate.cameraAngle !== current.cameraAngle) return "CAMERA_ANGLE";

  return "PROCESS_OR_RUNTIME";
}

export function buildPoseHistoryComparisonState(input: {
  measurement: PoseMeasurementForHistory | null;
  currentConditions: CurrentPoseComparisonConditions;
  matchingPrevious: PoseComparisonCandidate | null;
  latestSameTrick: PoseComparisonCandidate | null;
}): PoseHistoryComparisonState {
  const { measurement } = input;

  if (
    !measurement ||
    measurement.status !== "COMPLETED" ||
    measurement.minimumMeanKneeAngleDeg === null ||
    measurement.hipVerticalRangeTorsoUnits === null
  ) {
    return {
      kind: "unassessable",
      status: measurement?.status ?? "MISSING",
      qualityReasons: measurement?.qualityReasons ?? [],
    };
  }

  const current = {
    minimumMeanKneeAngleDeg: measurement.minimumMeanKneeAngleDeg,
    hipVerticalRangeTorsoUnits:
      measurement.hipVerticalRangeTorsoUnits,
  };

  if (
    input.matchingPrevious &&
    hasMatchingPoseComparisonConditions(
      input.currentConditions,
      input.matchingPrevious,
    )
  ) {
    return {
      kind: "comparison",
      current,
      previous: input.matchingPrevious,
    };
  }

  return {
    kind: "baseline",
    current,
    reason: resolvePoseComparisonUnavailableReason(
      input.currentConditions,
      input.latestSameTrick,
    ),
    currentVideoSpeed: input.currentConditions.videoSpeed,
    currentCameraAngle: input.currentConditions.cameraAngle,
  };
}

export function describeKneeAngleChange(current: number, previous: number) {
  const difference = current - previous;

  // These tolerances are provisional and must be finalized after real-device
  // comparisons. They describe stability only, never whether a value is good.
  if (Math.abs(difference) <= POSE_COMPARISON_THRESHOLDS.kneeAngleDeg) {
    return "ほぼ同じ";
  }

  return difference < 0
    ? `${Math.abs(difference).toFixed(1)}°深く曲がった`
    : `${difference.toFixed(1)}°浅く曲がった`;
}

export function describeHipVerticalRangeChange(
  current: number,
  previous: number,
) {
  const difference = current - previous;

  // Like the knee tolerance, 0.02 torso lengths is provisional until the
  // cross-device field comparison is complete.
  if (
    Math.abs(difference) <=
    POSE_COMPARISON_THRESHOLDS.hipVerticalRangeTorsoUnits
  ) {
    return "ほぼ同じ";
  }

  return difference < 0
    ? `上下動が${Math.abs(difference).toFixed(2)}胴長小さくなった`
    : `上下動が${difference.toFixed(2)}胴長大きくなった`;
}
