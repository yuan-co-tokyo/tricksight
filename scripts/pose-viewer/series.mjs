import { deriveFrame, hasVisibleIndices, LOWER_BODY_INDICES, quantile, calculatePoseMetrics } from "/pose/metrics";
import { createPoseMeasurement } from "/pose/measurement";
import { POSE_LANDMARKER_CONFIG as config } from "/pose/config";

export const names = { 23: "左腰", 24: "右腰", 25: "左膝", 26: "右膝", 27: "左足首", 28: "右足首", 31: "左つま先", 32: "右つま先" };
export function visible(point) {
  return !!point && (point.visibility ?? 1) >= config.confidenceThresholds.landmarkVisibility && (point.presence ?? 1) >= config.confidenceThresholds.landmarkVisibility;
}
export function summarize(run) {
  const calculated = calculatePoseMetrics(run);
  const measurement = createPoseMeasurement(calculated, run.processingMs);
  const derived = run.frames.map(deriveFrame);
  const valid = derived.filter(Boolean);
  const torso = quantile(valid.map(f => f.torsoLength), 0.5);
  const baseline = quantile(valid.map(f => f.hipY), 0.8);
  const frames = run.frames.map((frame, index) => {
    const d = derived[index];
    const hasPose = (frame.landmarks?.length ?? 0) >= 33;
    return {
      ...frame, derived: d,
      lowerBodyVisible: hasVisibleIndices(frame.landmarks, LOWER_BODY_INDICES),
      missing: LOWER_BODY_INDICES.filter(i => !hasPose || !visible(frame.landmarks[i])),
      hipHeightTorso: d && torso ? (baseline - d.hipY) / torso : null,
      kneeAsymmetryDeg: d?.leftKneeAngleDeg != null && d?.rightKneeAngleDeg != null ? Math.abs(d.leftKneeAngleDeg - d.rightKneeAngleDeg) : null,
      ankleAsymmetryTorso: d?.ankleHeightAsymmetry != null && torso ? d.ankleHeightAsymmetry / torso : null,
      footSeparationHipWidths: d?.footSeparation != null && d.hipWidth ? d.footSeparation / d.hipWidth : null,
    };
  });
  const kneeFrames = frames.filter(f => f.derived?.meanKneeAngleDeg != null).sort((a, b) => a.derived.meanKneeAngleDeg - b.derived.meanKneeAngleDeg);
  const position = (kneeFrames.length - 1) * 0.05;
  const kneeMinimum = kneeFrames[0] ?? null;
  const p05Frames = kneeFrames.length ? [kneeFrames[Math.floor(position)].timestampMs, kneeFrames[Math.ceil(position)].timestampMs] : [];
  // Contiguous missing sample intervals (end exclusive), without interpolation.
  const missingIntervals = [];
  for (const index of LOWER_BODY_INDICES) {
    let start = null;
    for (let i = 0; i <= frames.length; i++) {
      const missing = i < frames.length && frames[i].missing.includes(index);
      if (missing && start === null) start = frames[i].timestampMs;
      if (!missing && start !== null) {
        missingIntervals.push({ index, name: names[index], startMs: start, endMs: i < frames.length ? frames[i].timestampMs : run.durationMs });
        start = null;
      }
    }
  }
  return { ...run, frames, calculated, measurement, torso, baseline, kneeMinimumTimestampMs: kneeMinimum?.timestampMs ?? null, p05Frames, missingIntervals };
}
