import { describe, expect, it } from "vitest";

import {
  assessPoseQuality,
  calculatePoseMetrics,
  cliffsDelta,
  compareMetricGroups,
  comparePoseRuns,
  type PoseFrame,
  type PoseLandmark,
  type PoseRun,
} from "./pose-landmarker-metrics";

function landmarks(input: {
  hipY: number;
  ankleHeightDifference?: number;
  trunkOffset?: number;
}): PoseLandmark[] {
  const result = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
    presence: 1,
  }));
  const trunkOffset = input.trunkOffset ?? 0;
  result[11] = { ...result[11]!, x: 0.45 + trunkOffset, y: input.hipY - 0.2 };
  result[12] = { ...result[12]!, x: 0.55 + trunkOffset, y: input.hipY - 0.2 };
  result[23] = { ...result[23]!, x: 0.46, y: input.hipY };
  result[24] = { ...result[24]!, x: 0.54, y: input.hipY };
  result[25] = { ...result[25]!, x: 0.46, y: input.hipY + 0.15 };
  result[26] = { ...result[26]!, x: 0.54, y: input.hipY + 0.15 };
  result[27] = { ...result[27]!, x: 0.43, y: input.hipY + 0.3 };
  result[28] = {
    ...result[28]!,
    x: 0.57,
    y: input.hipY + 0.3 + (input.ankleHeightDifference ?? 0),
  };
  result[31] = { ...result[31]!, x: 0.4, y: input.hipY + 0.32 };
  result[32] = { ...result[32]!, x: 0.6, y: input.hipY + 0.32 };
  return result;
}

function frame(timestampMs: number, hipY: number): PoseFrame {
  const pose = landmarks({ hipY });
  return {
    timestampMs,
    inferenceMs: 20,
    landmarks: pose,
    worldLandmarks: structuredClone(pose),
  };
}

function run(frames: PoseFrame[]): PoseRun {
  return {
    mode: "fixed",
    fixedFps: 10,
    durationMs: 1_000,
    initializationMs: 100,
    processingMs: 500,
    presentedFrameGaps: 0,
    frames,
  };
}

describe("calculatePoseMetrics", () => {
  it("検出率と腰の上下動を固定フレームから計算する", () => {
    const metrics = calculatePoseMetrics(
      run([
        frame(0, 0.6),
        frame(100, 0.55),
        frame(200, 0.45),
        frame(300, 0.4),
        frame(400, 0.45),
        frame(500, 0.55),
        frame(600, 0.6),
      ]),
    );

    expect(metrics.poseCoverage).toBe(1);
    expect(metrics.lowerBodyCoverage).toBe(1);
    expect(metrics.hipRiseTorsoUnits).toBeGreaterThan(0.5);
    expect(metrics.detectedApexTimestampMs).toBe(300);
    expect(metrics.meanInferenceMs).toBe(20);
  });

  it("pose欠損を検出率へ反映する", () => {
    const metrics = calculatePoseMetrics(
      run([
        frame(0, 0.6),
        {
          timestampMs: 100,
          inferenceMs: 20,
          landmarks: null,
          worldLandmarks: null,
        },
      ]),
    );

    expect(metrics.poseCoverage).toBe(0.5);
    expect(metrics.lowerBodyCoverage).toBe(0.5);
  });
});

describe("comparePoseRuns", () => {
  it("同一の骨格値をbit一致として判定する", () => {
    const first = run([frame(0, 0.6), frame(100, 0.5)]);
    const second = structuredClone(first);

    expect(comparePoseRuns(first, second)).toMatchObject({
      frameCountEqual: true,
      timestampsEqual: true,
      maximumLandmarkDelta: 0,
    });
  });

  it("座標差の最大値を返す", () => {
    const first = run([frame(0, 0.6)]);
    const second = structuredClone(first);
    second.frames[0]!.landmarks![23]!.x += 0.01;

    expect(comparePoseRuns(first, second).maximumLandmarkDelta).toBeCloseTo(0.01);
  });
});

describe("group comparisons", () => {
  it("Cliff's deltaの向きをLANDED minus BAILEDで返す", () => {
    expect(cliffsDelta([3, 4], [1, 2])).toBe(1);
    expect(cliffsDelta([1, 2], [3, 4])).toBe(-1);
  });

  it("成功・失敗の指標分布を分ける", () => {
    const landed = calculatePoseMetrics(run([frame(0, 0.6), frame(100, 0.4)]));
    const bailed = {
      ...landed,
      hipRiseTorsoUnits: 0.1,
    };
    const comparison = compareMetricGroups([
      { expectedOutcome: "LANDED", metrics: landed },
      { expectedOutcome: "BAILED", metrics: bailed },
    ]).find((item) => item.metric === "hipRiseTorsoUnits");

    expect(comparison).toMatchObject({
      landedValues: [landed.hipRiseTorsoUnits],
      bailedValues: [0.1],
      cliffsDelta: 1,
    });
  });
});

describe("assessPoseQuality", () => {
  it("事前固定した80%閾値以上を判定可能にする", () => {
    const metrics = calculatePoseMetrics(
      run([
        frame(0, 0.6),
        frame(100, 0.55),
        frame(200, 0.5),
        frame(300, 0.45),
        {
          timestampMs: 400,
          inferenceMs: 20,
          landmarks: null,
          worldLandmarks: null,
        },
      ]),
    );

    expect(metrics.poseCoverage).toBe(0.8);
    expect(metrics.lowerBodyCoverage).toBe(0.8);
    expect(assessPoseQuality(metrics)).toEqual({
      status: "ASSESSABLE",
      reasons: [],
    });
  });

  it("poseまたは下半身の検出率が80%未満なら判定不能にする", () => {
    const metrics = calculatePoseMetrics(run([frame(0, 0.6)]));
    metrics.poseCoverage = 0.79;
    metrics.lowerBodyCoverage = 0.6;

    expect(assessPoseQuality(metrics)).toEqual({
      status: "UNASSESSABLE",
      reasons: [
        "POSE_COVERAGE_BELOW_THRESHOLD",
        "LOWER_BODY_COVERAGE_BELOW_THRESHOLD",
      ],
    });
  });
});
