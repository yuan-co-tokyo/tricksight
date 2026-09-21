import { describe, expect, it } from "vitest";

import {
  buildPoseHistoryComparisonState,
  describeHipVerticalRangeChange,
  describeKneeAngleChange,
  hasMatchingPoseComparisonConditions,
  resolvePoseComparisonUnavailableReason,
  type CurrentPoseComparisonConditions,
  type PoseComparisonCandidate,
} from "./history-comparison";

const currentConditions = {
  videoSpeed: "NORMAL",
  cameraAngle: "SIDE",
  algorithmVersion: "pose-v1",
  modelSha256: "model-sha",
  sampleRateFps: 10,
  delegate: "CPU",
  runtimeFamily: "CHROMIUM",
} satisfies CurrentPoseComparisonConditions;

const candidate = {
  sessionId: "previous-session",
  practicedAt: new Date("2026-09-20T03:00:00.000Z"),
  ...currentConditions,
  minimumMeanKneeAngleDeg: 90,
  hipVerticalRangeTorsoUnits: 0.5,
} satisfies PoseComparisonCandidate;

const completedMeasurement = {
  status: "COMPLETED" as const,
  qualityReasons: [],
  minimumMeanKneeAngleDeg: 84.8,
  hipVerticalRangeTorsoUnits: 0.54,
};

describe("pose history comparison", () => {
  it("accepts a candidate only when every non-ownership condition matches", () => {
    expect(hasMatchingPoseComparisonConditions(currentConditions, candidate)).toBe(
      true,
    );

    const mismatches: PoseComparisonCandidate[] = [
      { ...candidate, videoSpeed: "SLOW_MOTION" },
      { ...candidate, cameraAngle: "FRONT" },
      { ...candidate, algorithmVersion: "pose-v2" },
      { ...candidate, modelSha256: "other-sha" },
      { ...candidate, sampleRateFps: 12 },
      { ...candidate, delegate: "GPU" },
      { ...candidate, runtimeFamily: "WEBKIT" },
    ];

    for (const mismatch of mismatches) {
      expect(
        hasMatchingPoseComparisonConditions(currentConditions, mismatch),
      ).toBe(false);
      expect(
        buildPoseHistoryComparisonState({
          measurement: completedMeasurement,
          currentConditions,
          matchingPrevious: mismatch,
          latestSameTrick: mismatch,
        }),
      ).toMatchObject({ kind: "baseline" });
    }
  });

  it("does not require a success/failure self-report to compare", () => {
    expect(Object.keys(currentConditions)).not.toContain("userOutcome");
    expect(hasMatchingPoseComparisonConditions(currentConditions, candidate)).toBe(
      true,
    );
  });

  it("explains no comparison using the approved reason priority", () => {
    expect(resolvePoseComparisonUnavailableReason(currentConditions, null)).toBe(
      "NO_SAME_TRICK_MEASUREMENT",
    );
    expect(
      resolvePoseComparisonUnavailableReason(currentConditions, {
        ...candidate,
        videoSpeed: "SLOW_MOTION",
        cameraAngle: "FRONT",
      }),
    ).toBe("VIDEO_SPEED");
    expect(
      resolvePoseComparisonUnavailableReason(currentConditions, {
        ...candidate,
        cameraAngle: "FRONT",
      }),
    ).toBe("CAMERA_ANGLE");
    expect(
      resolvePoseComparisonUnavailableReason(currentConditions, {
        ...candidate,
        runtimeFamily: "WEBKIT",
      }),
    ).toBe("PROCESS_OR_RUNTIME");
  });

  it("uses provisional inclusive thresholds without assigning good or bad", () => {
    expect(describeKneeAngleChange(88, 90)).toBe("ほぼ同じ");
    expect(describeKneeAngleChange(84.8, 90)).toBe("5.2°深く曲がった");
    expect(describeKneeAngleChange(95.2, 90)).toBe("5.2°浅く曲がった");
    expect(describeHipVerticalRangeChange(0.519, 0.5)).toBe("ほぼ同じ");
    expect(describeHipVerticalRangeChange(0.54, 0.5)).toBe(
      "上下動が0.04胴長大きくなった",
    );
    expect(describeHipVerticalRangeChange(0.46, 0.5)).toBe(
      "上下動が0.04胴長小さくなった",
    );
  });

  it("builds comparison, baseline, and unassessable states", () => {
    expect(
      buildPoseHistoryComparisonState({
        measurement: completedMeasurement,
        currentConditions,
        matchingPrevious: candidate,
        latestSameTrick: candidate,
      }),
    ).toMatchObject({ kind: "comparison" });
    expect(
      buildPoseHistoryComparisonState({
        measurement: completedMeasurement,
        currentConditions,
        matchingPrevious: null,
        latestSameTrick: null,
      }),
    ).toMatchObject({
      kind: "baseline",
      reason: "NO_SAME_TRICK_MEASUREMENT",
    });
    expect(
      buildPoseHistoryComparisonState({
        measurement: {
          ...completedMeasurement,
          status: "UNASSESSABLE",
          minimumMeanKneeAngleDeg: null,
          hipVerticalRangeTorsoUnits: null,
        },
        currentConditions,
        matchingPrevious: null,
        latestSameTrick: null,
      }),
    ).toMatchObject({ kind: "unassessable", status: "UNASSESSABLE" });
  });
});
