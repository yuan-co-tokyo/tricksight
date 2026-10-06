// Pure calculations shared by upload aggregates and display-only samples.
import { POSE_LANDMARKER_CONFIG } from "./config";
import type { PoseFrame, PoseLandmark } from "./metrics";

export const CORE_INDICES = [11, 12, 23, 24];
export const LOWER_BODY_INDICES = [23, 24, 25, 26, 27, 28, 31, 32];
const VISIBILITY_THRESHOLD =
  POSE_LANDMARKER_CONFIG.confidenceThresholds.landmarkVisibility;

export type DerivedFrame = {
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

export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function visible(landmark: PoseLandmark | undefined) {
  if (!landmark) return false;
  const visibility = landmark.visibility ?? 1;
  const presence = landmark.presence ?? 1;
  return visibility >= VISIBILITY_THRESHOLD && presence >= VISIBILITY_THRESHOLD;
}

export function hasVisibleIndices(
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

export function quantile(values: number[], fraction: number) {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;

  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export function deriveFrame(frame: PoseFrame): DerivedFrame | null {
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

