// Pure TypeScript: shared by the product Worker and the evaluation scripts.
// Keep this module free of React, Next.js, Node.js, and browser globals.
import { POSE_LANDMARKER_CONFIG } from "./config";

export type PoseLandmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
};

export type PoseFrame = {
  timestampMs: number;
  inferenceMs: number;
  landmarks: PoseLandmark[] | null;
  worldLandmarks: PoseLandmark[] | null;
};

export type PoseRun = {
  mode: "fixed" | "all-frames";
  fixedFps: number | null;
  durationMs: number;
  videoWidth: number;
  videoHeight: number;
  initializationMs: number;
  processingMs: number;
  presentedFrameGaps: number;
  frames: PoseFrame[];
};

export type PoseMetricName =
  | "poseCoverage"
  | "lowerBodyCoverage"
  | "meanInferenceMs"
  | "p95InferenceMs"
  | "minimumMeanKneeAngleDeg"
  | "kneeExtensionRangeDeg"
  | "hipRiseTorsoUnits"
  | "hipRiseDurationMs"
  | "landingAnkleHeightAsymmetryTorsoUnits"
  | "landingFootSeparationHipWidths"
  | "landingMeanKneeAngleDeg"
  | "landingKneeAsymmetryDeg"
  | "landingTrunkTiltDeg"
  | "postLandingTrunkTiltRangeDeg"
  | "postLandingHipRangeTorsoUnits"
  | "p95TrunkAngularSpeedDegPerSecond";

export type PoseMetrics = Record<PoseMetricName, number | null> & {
  frameCount: number;
  poseFrameCount: number;
  lowerBodyFrameCount: number;
  detectedApexTimestampMs: number | null;
  detectedLandingTimestampMs: number | null;
};

export type MetricComparison = {
  metric: PoseMetricName;
  landedValues: number[];
  bailedValues: number[];
  landedMedian: number | null;
  bailedMedian: number | null;
  medianDifference: number | null;
  cliffsDelta: number | null;
};

export const poseQualityPolicy = {
  poseCoverageMinimum:
    POSE_LANDMARKER_CONFIG.qualityThresholds.poseCoverage,
  lowerBodyCoverageMinimum:
    POSE_LANDMARKER_CONFIG.qualityThresholds.lowerBodyCoverage,
  rationale:
    "固定10fpsで全フレームの80%以上から33点poseと可視な下半身8点を取得できる場合のみ、時系列・着地指標を判定可能とする。最大20%の散発欠損は許容するが、それを超える欠損では動作の重要局面を取り逃すリスクが高い。全17本の結果を見る前に固定した閾値であり、群差に合わせて調整しない。",
} as const;

export type PoseQualityAssessment = {
  status: "ASSESSABLE" | "UNASSESSABLE";
  reasons: Array<"POSE_COVERAGE_BELOW_THRESHOLD" | "LOWER_BODY_COVERAGE_BELOW_THRESHOLD">;
};

export const poseMetricDefinitions: Record<
  PoseMetricName,
  { description: string; hypothesis: string }
> = {
  poseCoverage: {
    description: "33点のposeが得られたフレーム比率",
    hypothesis: "引きの画、高速動作、遮蔽で低下する",
  },
  lowerBodyCoverage: {
    description: "腰・膝・足首・つま先が全てvisibility 0.5以上のフレーム比率",
    hypothesis: "板や画角で下半身が隠れる動画では低下する",
  },
  meanInferenceMs: {
    description: "1フレームあたりの平均Pose Landmarker推論時間",
    hypothesis: "端末上の処理時間見積もりに使う",
  },
  p95InferenceMs: {
    description: "1フレームあたりのp95推論時間",
    hypothesis: "平均では隠れる遅いフレームを把握する",
  },
  minimumMeanKneeAngleDeg: {
    description: "左右膝角度平均の最小値（小さいほど深く曲げる）",
    hypothesis: "踏み切り・着地時の屈曲量に成功失敗差が出る可能性がある",
  },
  kneeExtensionRangeDeg: {
    description: "左右膝角度平均のp90-p10",
    hypothesis: "踏み切り中の屈曲から伸展までの運動幅を表す",
  },
  hipRiseTorsoUnits: {
    description: "腰中心の上下範囲を胴長で正規化した値",
    hypothesis: "ポップと跳躍の大きさの代理になる",
  },
  hipRiseDurationMs: {
    description: "腰上昇量の50%を上回ってから戻るまでの時間",
    hypothesis: "踏み切りから着地までの時間の代理になる。ただしスロー撮影に依存する",
  },
  landingAnkleHeightAsymmetryTorsoUnits: {
    description: "推定着地後の左右足首高さ差を胴長で正規化した中央値",
    hypothesis: "片足が外れる、または左右が揃わない失敗で大きくなる可能性がある",
  },
  landingFootSeparationHipWidths: {
    description: "推定着地後の左右足首距離を腰幅で正規化した中央値",
    hypothesis: "着地時の足幅が極端な失敗で差が出る可能性がある",
  },
  landingMeanKneeAngleDeg: {
    description: "推定着地後の左右膝角度平均の中央値",
    hypothesis: "着地衝撃を吸収する屈曲姿勢の差を表す可能性がある",
  },
  landingKneeAsymmetryDeg: {
    description: "推定着地後の左右膝角度差の中央値",
    hypothesis: "片足着地やバランス崩れで大きくなる可能性がある",
  },
  landingTrunkTiltDeg: {
    description: "推定着地後の体幹の鉛直からの傾き中央値",
    hypothesis: "大きく傾いた着地失敗で増える可能性がある",
  },
  postLandingTrunkTiltRangeDeg: {
    description: "推定着地後の体幹傾斜p90-p10",
    hypothesis: "着地後に姿勢を崩した失敗で増える可能性がある",
  },
  postLandingHipRangeTorsoUnits: {
    description: "推定着地後の腰上下p90-p10を胴長で正規化した値",
    hypothesis: "着地後の上下動・転倒で増える可能性がある",
  },
  p95TrunkAngularSpeedDegPerSecond: {
    description: "体幹角速度絶対値のp95",
    hypothesis: "急激に上体を崩した失敗で増える可能性がある",
  },
};

const CORE_INDICES = [11, 12, 23, 24];
const LOWER_BODY_INDICES = [23, 24, 25, 26, 27, 28, 31, 32];
const VISIBILITY_THRESHOLD =
  POSE_LANDMARKER_CONFIG.confidenceThresholds.landmarkVisibility;

type DerivedFrame = {
  timestampMs: number;
  torsoLength: number;
  hipWidth: number;
  hipY: number;
  trunkTiltDeg: number;
  leftKneeAngleDeg: number | null;
  rightKneeAngleDeg: number | null;
  meanKneeAngleDeg: number | null;
  ankleHeightAsymmetry: number | null;
  footSeparation: number | null;
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function visible(landmark: PoseLandmark | undefined) {
  if (!landmark) return false;
  const visibility = landmark.visibility ?? 1;
  const presence = landmark.presence ?? 1;
  return visibility >= VISIBILITY_THRESHOLD && presence >= VISIBILITY_THRESHOLD;
}

function hasVisibleIndices(
  landmarks: PoseLandmark[] | null,
  indices: readonly number[],
) {
  return Boolean(
    landmarks && landmarks.length >= 33 && indices.every((index) => visible(landmarks[index])),
  );
}

function midpoint(a: PoseLandmark, b: PoseLandmark): PoseLandmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

function distance2d(a: PoseLandmark, b: PoseLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleDeg(a: PoseLandmark, vertex: PoseLandmark, c: PoseLandmark) {
  const first = {
    x: a.x - vertex.x,
    y: a.y - vertex.y,
    z: a.z - vertex.z,
  };
  const second = {
    x: c.x - vertex.x,
    y: c.y - vertex.y,
    z: c.z - vertex.z,
  };
  const denominator =
    Math.hypot(first.x, first.y, first.z) *
    Math.hypot(second.x, second.y, second.z);
  if (denominator <= Number.EPSILON) return null;

  const cosine = Math.min(
    1,
    Math.max(
      -1,
      (first.x * second.x + first.y * second.y + first.z * second.z) /
        denominator,
    ),
  );
  return (Math.acos(cosine) * 180) / Math.PI;
}

function quantile(values: number[], fraction: number) {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;

  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function median(values: number[]) {
  return quantile(values, 0.5);
}

function mean(values: number[]) {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rangeBetween(values: number[], lower: number, upper: number) {
  const low = quantile(values, lower);
  const high = quantile(values, upper);
  return low === null || high === null ? null : high - low;
}

function deriveFrame(frame: PoseFrame): DerivedFrame | null {
  const landmarks = frame.landmarks;
  const world = frame.worldLandmarks;
  if (!hasVisibleIndices(landmarks, CORE_INDICES) || !landmarks) return null;

  const shoulderMid = midpoint(landmarks[11]!, landmarks[12]!);
  const hipMid = midpoint(landmarks[23]!, landmarks[24]!);
  const torsoLength = distance2d(shoulderMid, hipMid);
  const hipWidth = distance2d(landmarks[23]!, landmarks[24]!);
  if (torsoLength <= Number.EPSILON || hipWidth <= Number.EPSILON) return null;

  const trunkTiltDeg =
    (Math.atan2(Math.abs(shoulderMid.x - hipMid.x), Math.abs(shoulderMid.y - hipMid.y)) *
      180) /
    Math.PI;
  const lowerBodyVisible = hasVisibleIndices(landmarks, LOWER_BODY_INDICES);
  const angleSource = world && world.length >= 33 ? world : landmarks;
  const leftKneeAngleDeg = lowerBodyVisible
    ? angleDeg(angleSource[23]!, angleSource[25]!, angleSource[27]!)
    : null;
  const rightKneeAngleDeg = lowerBodyVisible
    ? angleDeg(angleSource[24]!, angleSource[26]!, angleSource[28]!)
    : null;
  const meanKneeAngleDeg =
    leftKneeAngleDeg === null || rightKneeAngleDeg === null
      ? null
      : (leftKneeAngleDeg + rightKneeAngleDeg) / 2;

  return {
    timestampMs: frame.timestampMs,
    torsoLength,
    hipWidth,
    hipY: hipMid.y,
    trunkTiltDeg,
    leftKneeAngleDeg,
    rightKneeAngleDeg,
    meanKneeAngleDeg,
    ankleHeightAsymmetry: lowerBodyVisible
      ? Math.abs(landmarks[27]!.y - landmarks[28]!.y)
      : null,
    footSeparation: lowerBodyVisible
      ? distance2d(landmarks[27]!, landmarks[28]!)
      : null,
  };
}

function detectMovementWindow(frames: DerivedFrame[], durationMs: number) {
  if (frames.length < 5) {
    return { apexTimestampMs: null, landingTimestampMs: null, riseDurationMs: null };
  }

  const middle = frames.filter(
    (frame) =>
      frame.timestampMs >= durationMs * 0.05 &&
      frame.timestampMs <= durationMs * 0.95,
  );
  const candidates = middle.length >= 5 ? middle : frames;
  const apex = candidates.reduce((best, frame) =>
    frame.hipY < best.hipY ? frame : best,
  );
  const before = frames.filter((frame) => frame.timestampMs < apex.timestampMs);
  const after = frames.filter((frame) => frame.timestampMs > apex.timestampMs);
  const baseline = quantile(frames.map((frame) => frame.hipY), 0.8);
  if (baseline === null || before.length === 0 || after.length === 0) {
    return {
      apexTimestampMs: apex.timestampMs,
      landingTimestampMs: null,
      riseDurationMs: null,
    };
  }

  const amplitude = baseline - apex.hipY;
  if (amplitude <= 0) {
    return {
      apexTimestampMs: apex.timestampMs,
      landingTimestampMs: null,
      riseDurationMs: null,
    };
  }

  const crossing = apex.hipY + amplitude * 0.5;
  const takeoff = before.findLast((frame) => frame.hipY >= crossing);
  const landing = after.find((frame) => frame.hipY >= crossing);
  return {
    apexTimestampMs: apex.timestampMs,
    landingTimestampMs: landing?.timestampMs ?? null,
    riseDurationMs:
      takeoff && landing ? landing.timestampMs - takeoff.timestampMs : null,
  };
}

function nullableRatio(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

export function calculatePoseMetrics(run: PoseRun): PoseMetrics {
  const poseFrames = run.frames.filter(
    (frame) => frame.landmarks && frame.landmarks.length >= 33,
  );
  const lowerBodyFrames = poseFrames.filter((frame) =>
    hasVisibleIndices(frame.landmarks, LOWER_BODY_INDICES),
  );
  const derivedFrames = run.frames
    .map(deriveFrame)
    .filter((frame): frame is DerivedFrame => frame !== null);
  const torsoLength = median(derivedFrames.map((frame) => frame.torsoLength));
  const movement = detectMovementWindow(derivedFrames, run.durationMs);
  const landingWindowMs = Math.min(1_500, Math.max(500, run.durationMs * 0.15));
  const landingFrames =
    movement.landingTimestampMs === null
      ? []
      : derivedFrames.filter(
          (frame) =>
            frame.timestampMs >= movement.landingTimestampMs! &&
            frame.timestampMs <= movement.landingTimestampMs! + landingWindowMs,
        );
  const kneeAngles = derivedFrames
    .map((frame) => frame.meanKneeAngleDeg)
    .filter(finite);
  const inferenceTimes = run.frames.map((frame) => frame.inferenceMs);
  const angularSpeeds = derivedFrames.flatMap((frame, index) => {
    if (index === 0) return [];
    const previous = derivedFrames[index - 1]!;
    const elapsedSeconds = (frame.timestampMs - previous.timestampMs) / 1_000;
    if (elapsedSeconds <= 0) return [];
    return [Math.abs(frame.trunkTiltDeg - previous.trunkTiltDeg) / elapsedSeconds];
  });
  const hipRange = rangeBetween(
    derivedFrames.map((frame) => frame.hipY),
    0.1,
    0.9,
  );

  return {
    frameCount: run.frames.length,
    poseFrameCount: poseFrames.length,
    lowerBodyFrameCount: lowerBodyFrames.length,
    detectedApexTimestampMs: movement.apexTimestampMs,
    detectedLandingTimestampMs: movement.landingTimestampMs,
    poseCoverage: nullableRatio(poseFrames.length, run.frames.length),
    lowerBodyCoverage: nullableRatio(lowerBodyFrames.length, run.frames.length),
    meanInferenceMs: mean(inferenceTimes),
    p95InferenceMs: quantile(inferenceTimes, 0.95),
    minimumMeanKneeAngleDeg: quantile(kneeAngles, 0.05),
    kneeExtensionRangeDeg: rangeBetween(kneeAngles, 0.1, 0.9),
    hipRiseTorsoUnits:
      hipRange === null || torsoLength === null ? null : hipRange / torsoLength,
    hipRiseDurationMs: movement.riseDurationMs,
    landingAnkleHeightAsymmetryTorsoUnits:
      torsoLength === null
        ? null
        : nullableMedian(
            landingFrames.map((frame) => frame.ankleHeightAsymmetry),
            torsoLength,
          ),
    landingFootSeparationHipWidths: median(
      landingFrames.flatMap((frame) =>
        frame.footSeparation === null
          ? []
          : [frame.footSeparation / frame.hipWidth],
      ),
    ),
    landingMeanKneeAngleDeg: median(
      landingFrames.map((frame) => frame.meanKneeAngleDeg).filter(finite),
    ),
    landingKneeAsymmetryDeg: median(
      landingFrames.flatMap((frame) =>
        frame.leftKneeAngleDeg === null || frame.rightKneeAngleDeg === null
          ? []
          : [Math.abs(frame.leftKneeAngleDeg - frame.rightKneeAngleDeg)],
      ),
    ),
    landingTrunkTiltDeg: median(
      landingFrames.map((frame) => frame.trunkTiltDeg),
    ),
    postLandingTrunkTiltRangeDeg: rangeBetween(
      landingFrames.map((frame) => frame.trunkTiltDeg),
      0.1,
      0.9,
    ),
    postLandingHipRangeTorsoUnits:
      torsoLength === null
        ? null
        : nullableRange(
            landingFrames.map((frame) => frame.hipY),
            torsoLength,
          ),
    p95TrunkAngularSpeedDegPerSecond: quantile(angularSpeeds, 0.95),
  };
}

function nullableMedian(values: Array<number | null>, denominator: number) {
  const value = median(values.filter(finite));
  return value === null ? null : value / denominator;
}

function nullableRange(values: number[], denominator: number) {
  const value = rangeBetween(values, 0.1, 0.9);
  return value === null ? null : value / denominator;
}

export function cliffsDelta(first: number[], second: number[]) {
  if (first.length === 0 || second.length === 0) return null;
  let greater = 0;
  let lower = 0;

  for (const firstValue of first) {
    for (const secondValue of second) {
      if (firstValue > secondValue) greater += 1;
      if (firstValue < secondValue) lower += 1;
    }
  }

  return (greater - lower) / (first.length * second.length);
}

export function compareMetricGroups(
  samples: Array<{ expectedOutcome: "LANDED" | "BAILED"; metrics: PoseMetrics }>,
): MetricComparison[] {
  return (Object.keys(poseMetricDefinitions) as PoseMetricName[]).map((metric) => {
    const landedValues = samples.flatMap((sample) => {
      const value = sample.metrics[metric];
      return sample.expectedOutcome === "LANDED" && finite(value) ? [value] : [];
    });
    const bailedValues = samples.flatMap((sample) => {
      const value = sample.metrics[metric];
      return sample.expectedOutcome === "BAILED" && finite(value) ? [value] : [];
    });
    const landedMedian = median(landedValues);
    const bailedMedian = median(bailedValues);

    return {
      metric,
      landedValues,
      bailedValues,
      landedMedian,
      bailedMedian,
      medianDifference:
        landedMedian === null || bailedMedian === null
          ? null
          : landedMedian - bailedMedian,
      cliffsDelta: cliffsDelta(landedValues, bailedValues),
    };
  });
}

export function assessPoseQuality(metrics: PoseMetrics): PoseQualityAssessment {
  const reasons: PoseQualityAssessment["reasons"] = [];
  if (
    metrics.poseCoverage === null ||
    metrics.poseCoverage < poseQualityPolicy.poseCoverageMinimum
  ) {
    reasons.push("POSE_COVERAGE_BELOW_THRESHOLD");
  }
  if (
    metrics.lowerBodyCoverage === null ||
    metrics.lowerBodyCoverage < poseQualityPolicy.lowerBodyCoverageMinimum
  ) {
    reasons.push("LOWER_BODY_COVERAGE_BELOW_THRESHOLD");
  }

  return {
    status: reasons.length === 0 ? "ASSESSABLE" : "UNASSESSABLE",
    reasons,
  };
}

export function comparePoseRuns(first: PoseRun, second: PoseRun) {
  const frameCountEqual = first.frames.length === second.frames.length;
  const comparedFrameCount = Math.min(first.frames.length, second.frames.length);
  let timestampsEqual = frameCountEqual;
  let maximumLandmarkDelta = 0;
  let comparableLandmarkValueCount = 0;

  for (let frameIndex = 0; frameIndex < comparedFrameCount; frameIndex += 1) {
    const firstFrame = first.frames[frameIndex]!;
    const secondFrame = second.frames[frameIndex]!;
    if (firstFrame.timestampMs !== secondFrame.timestampMs) timestampsEqual = false;

    for (const key of ["landmarks", "worldLandmarks"] as const) {
      const firstLandmarks = firstFrame[key];
      const secondLandmarks = secondFrame[key];
      if (!firstLandmarks || !secondLandmarks) {
        if (firstLandmarks !== secondLandmarks) maximumLandmarkDelta = Infinity;
        continue;
      }
      if (firstLandmarks.length !== secondLandmarks.length) {
        maximumLandmarkDelta = Infinity;
        continue;
      }

      for (let index = 0; index < firstLandmarks.length; index += 1) {
        const firstLandmark = firstLandmarks[index]!;
        const secondLandmark = secondLandmarks[index]!;
        for (const coordinate of ["x", "y", "z", "visibility", "presence"] as const) {
          const firstValue = firstLandmark[coordinate];
          const secondValue = secondLandmark[coordinate];
          if (!finite(firstValue) || !finite(secondValue)) continue;
          comparableLandmarkValueCount += 1;
          maximumLandmarkDelta = Math.max(
            maximumLandmarkDelta,
            Math.abs(firstValue - secondValue),
          );
        }
      }
    }
  }

  const firstMetrics = calculatePoseMetrics(first);
  const secondMetrics = calculatePoseMetrics(second);
  const metricDeltas = Object.fromEntries(
    (Object.keys(poseMetricDefinitions) as PoseMetricName[]).map((metric) => {
      const firstValue = firstMetrics[metric];
      const secondValue = secondMetrics[metric];
      return [
        metric,
        finite(firstValue) && finite(secondValue)
          ? Math.abs(firstValue - secondValue)
          : firstValue === secondValue
            ? 0
            : null,
      ];
    }),
  ) as Record<PoseMetricName, number | null>;

  return {
    frameCountEqual,
    timestampsEqual,
    comparableLandmarkValueCount,
    maximumLandmarkDelta,
    metricDeltas,
  };
}
