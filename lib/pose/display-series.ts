import { deriveFrame, quantile, CORE_INDICES, LOWER_BODY_INDICES } from "./frame-metrics";
import type { PoseFrame, PoseLandmark } from "./metrics";
import type { DisplaySample } from "./display-protocol";
import { POSE_LANDMARKER_CONFIG } from "./config";

export function drawable(point: PoseLandmark | undefined) {
  const threshold = POSE_LANDMARKER_CONFIG.confidenceThresholds.landmarkVisibility;
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 &&
    (point.visibility ?? 1) >= threshold && (point.presence ?? 1) >= threshold;
}
export function displaySeries(frames: readonly PoseFrame[]) {
  const derived = frames.map(deriveFrame);
  const valid = derived.filter(f => f !== null);
  const torso = quantile(valid.map(f => f.torsoLength), .5);
  const baseline = quantile(valid.map(f => f.hipY), .8);
  return { derived, torso, baseline };
}
export function displaySample(frames: readonly PoseFrame[], series: ReturnType<typeof displaySeries>, durationMs: number, assessable: boolean, time: number): { index: number; sample: DisplaySample } {
  const sample: DisplaySample = { playbackTimestampMs: time, sampleTimestampMs: null,
    values: { meanKneeAngleDeg: null, hipRelativeHeightTorsoUnits: null }, missingReasons: [], drawnPointCount: 0 };
  const index = frames.findLastIndex(f => f.timestampMs <= time);
  const frame = frames[index];
  if (time < 0 || time >= durationMs || !frame || time - frame.timestampMs >= 100) {
    sample.missingReasons.push("OUT_OF_RANGE");return { index: -1, sample };
  }
  sample.sampleTimestampMs = frame.timestampMs;
  if (!frame.landmarks || frame.landmarks.length < 33) {
    sample.missingReasons.push("POSE_MISSING");return { index, sample };
  }
  if (frame.landmarks.some(p => !drawable(p))) sample.missingReasons.push("PARTIAL_SKELETON");
  const d = series.derived[index];
  const core = CORE_INDICES.every(i => drawable(frame.landmarks![i]));
  const lower = LOWER_BODY_INDICES.every(i => drawable(frame.landmarks![i]));
  if (!assessable) sample.missingReasons.push("GLOBAL_QUALITY");
  if (!d || !core) sample.missingReasons.push("CORE_UNRELIABLE");
  if (!lower || (d && !Number.isFinite(d.meanKneeAngleDeg))) sample.missingReasons.push("LOWER_BODY_UNRELIABLE");
  if ([...CORE_INDICES, ...LOWER_BODY_INDICES].some(i => {
    const p=frame.landmarks![i];return p && (!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1);
  })) sample.missingReasons.push("OUT_OF_BOUNDS");
  if (assessable && d && core) {
    if (lower && Number.isFinite(d.meanKneeAngleDeg)) sample.values.meanKneeAngleDeg = d.meanKneeAngleDeg;
    if (series.torso && series.baseline !== null) {
      const value = (series.baseline - d.hipY) / series.torso;
      if (Number.isFinite(value)) sample.values.hipRelativeHeightTorsoUnits = value;
    }
  }
  return { index, sample };
}
