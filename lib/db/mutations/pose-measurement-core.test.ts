import { beforeEach, describe, expect, it, vi } from "vitest";

import { POSE_LANDMARKER_CONFIG } from "../../pose/config";

import {
  createPoseMeasurementSaver,
  PoseMeasurementSaveError,
  type PoseMeasurementInsertValues,
  type PoseMeasurementStore,
  type SavedPoseMeasurement,
} from "./pose-measurement-core";

const videoId = "11111111-1111-4111-8111-111111111111";
const measurementId = "22222222-2222-4222-8222-222222222222";
const completedAt = new Date("2026-09-21T00:00:00.000Z");

function completedInput() {
  return {
    videoId,
    runtimeFamily: "CHROMIUM" as const,
    measurement: {
      status: "COMPLETED" as const,
      quality: {
        frameCount: 100,
        poseFrameCount: 90,
        lowerBodyFrameCount: 85,
        poseCoverage: 0.9,
        lowerBodyCoverage: 0.85,
        reasons: [],
      },
      metrics: {
        minimumMeanKneeAngleDeg: 72.5,
        kneeExtensionRangeDeg: 51.25,
        hipVerticalRangeTorsoUnits: 0.81,
        landingTrunkTiltDeg: null,
      },
      processingDurationMs: 2_345,
    },
  };
}

function unassessableInput() {
  return {
    videoId,
    runtimeFamily: "WEBKIT" as const,
    measurement: {
      status: "UNASSESSABLE" as const,
      quality: {
        frameCount: 100,
        poseFrameCount: 70,
        lowerBodyFrameCount: 60,
        poseCoverage: 0.7,
        lowerBodyCoverage: 0.6,
        reasons: [
          "POSE_COVERAGE_BELOW_THRESHOLD" as const,
          "LOWER_BODY_COVERAGE_BELOW_THRESHOLD" as const,
        ],
      },
      metrics: null,
      processingDurationMs: 1_500,
    },
  };
}

function savedMeasurement(
  values: PoseMeasurementInsertValues,
): SavedPoseMeasurement {
  return {
    ...values,
    createdAt: completedAt,
    updatedAt: completedAt,
  } as SavedPoseMeasurement;
}

function setup() {
  const findOwnedVideo = vi.fn().mockResolvedValue({ id: videoId });
  const insertMeasurement = vi
    .fn()
    .mockImplementation(async (values: PoseMeasurementInsertValues) =>
      savedMeasurement(values),
    );
  const findOwnedMeasurementByVideoId = vi.fn().mockResolvedValue(null);
  const transaction = vi.fn();
  const store: PoseMeasurementStore = {
    async transaction(operation) {
      transaction(operation);
      return operation({
        findOwnedVideo,
        insertMeasurement,
        findOwnedMeasurementByVideoId,
      });
    },
  };
  const saver = createPoseMeasurementSaver({
    resolveCurrentUser: vi.fn().mockResolvedValue({ id: "owner-user" }),
    store,
    createId: () => measurementId,
    now: () => completedAt,
  });

  return {
    saver,
    transaction,
    findOwnedVideo,
    insertMeasurement,
    findOwnedMeasurementByVideoId,
  };
}

describe("pose measurement save boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an unauthenticated save before opening a transaction", async () => {
    const transaction = vi.fn();
    const store: PoseMeasurementStore = {
      transaction(operation) {
        transaction(operation);
        throw new Error("The transaction must not be opened.");
      },
    };
    const saver = createPoseMeasurementSaver({
      resolveCurrentUser: vi.fn().mockResolvedValue(null),
      store,
      createId: () => measurementId,
      now: () => completedAt,
    });

    await expect(saver(completedInput())).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    } satisfies Partial<PoseMeasurementSaveError>);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not expose or write a video owned by another user", async () => {
    const { saver, findOwnedVideo, insertMeasurement } = setup();
    findOwnedVideo.mockResolvedValue(null);

    await expect(saver(completedInput())).rejects.toMatchObject({
      code: "VIDEO_NOT_FOUND",
    } satisfies Partial<PoseMeasurementSaveError>);
    expect(findOwnedVideo).toHaveBeenCalledWith({
      userId: "owner-user",
      videoId,
    });
    expect(insertMeasurement).not.toHaveBeenCalled();
  });

  it("recomputes coverage and stores server-owned processing metadata", async () => {
    const { saver, insertMeasurement } = setup();

    await expect(saver(completedInput())).resolves.toMatchObject({
      outcome: "CREATED",
      measurement: { status: "COMPLETED", videoId },
    });
    expect(insertMeasurement).toHaveBeenCalledWith(
      expect.objectContaining({
        id: measurementId,
        videoId,
        status: "COMPLETED",
        poseCoverage: 0.9,
        lowerBodyCoverage: 0.85,
        algorithmVersion: POSE_LANDMARKER_CONFIG.algorithmVersion,
        tasksVisionVersion: POSE_LANDMARKER_CONFIG.tasksVisionVersion,
        modelSha256: POSE_LANDMARKER_CONFIG.model.sha256,
        sampleRateFps: POSE_LANDMARKER_CONFIG.sampleRateFps,
        delegate: POSE_LANDMARKER_CONFIG.delegate,
        completedAt,
      }),
    );
  });

  it("rejects non-finite, out-of-range, and inconsistent client aggregates", async () => {
    const invalidInputs = [
      {
        ...completedInput(),
        measurement: {
          ...completedInput().measurement,
          metrics: {
            ...completedInput().measurement.metrics,
            minimumMeanKneeAngleDeg: Number.NaN,
          },
        },
      },
      {
        ...completedInput(),
        measurement: {
          ...completedInput().measurement,
          metrics: {
            ...completedInput().measurement.metrics,
            hipVerticalRangeTorsoUnits: Number.POSITIVE_INFINITY,
          },
        },
      },
      {
        ...completedInput(),
        measurement: {
          ...completedInput().measurement,
          metrics: {
            ...completedInput().measurement.metrics,
            kneeExtensionRangeDeg: 181,
          },
        },
      },
      {
        ...completedInput(),
        measurement: {
          ...completedInput().measurement,
          quality: {
            ...completedInput().measurement.quality,
            poseFrameCount: 101,
          },
        },
      },
      {
        ...completedInput(),
        measurement: {
          ...completedInput().measurement,
          quality: {
            ...completedInput().measurement.quality,
            lowerBodyFrameCount: 91,
          },
        },
      },
      {
        ...completedInput(),
        measurement: {
          ...completedInput().measurement,
          quality: {
            ...completedInput().measurement.quality,
            poseCoverage: 0.91,
          },
        },
      },
      {
        ...unassessableInput(),
        measurement: {
          ...unassessableInput().measurement,
          status: "COMPLETED" as const,
          metrics: completedInput().measurement.metrics,
        },
      },
    ];

    for (const input of invalidInputs) {
      const { saver, insertMeasurement } = setup();
      await expect(saver(input)).rejects.toMatchObject({ name: "ZodError" });
      expect(insertMeasurement).not.toHaveBeenCalled();
    }
  });

  it("stores UNASSESSABLE with counts and coverage only", async () => {
    const { saver, insertMeasurement } = setup();

    await saver(unassessableInput());

    expect(insertMeasurement).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "UNASSESSABLE",
        frameCount: 100,
        poseFrameCount: 70,
        lowerBodyFrameCount: 60,
        poseCoverage: 0.7,
        lowerBodyCoverage: 0.6,
        minimumMeanKneeAngleDeg: null,
        kneeExtensionRangeDeg: null,
        hipVerticalRangeTorsoUnits: null,
        landingTrunkTiltDeg: null,
        errorCode: null,
      }),
    );
  });

  it.each([
    ["FAILED", "MODEL_LOAD_FAILED"],
    ["TIMED_OUT", undefined],
    ["CANCELED", undefined],
  ] as const)("stores %s without quality or aggregates", async (status, errorCode) => {
    const { saver, insertMeasurement } = setup();
    const measurement = {
      status,
      quality: null,
      metrics: null,
      processingDurationMs: 250,
      ...(errorCode ? { errorCode } : {}),
    };

    await saver({ videoId, runtimeFamily: "CHROMIUM", measurement });

    expect(insertMeasurement).toHaveBeenCalledWith(
      expect.objectContaining({
        status,
        qualityReasons: [],
        errorCode: errorCode ?? null,
        frameCount: null,
        poseFrameCount: null,
        lowerBodyFrameCount: null,
        poseCoverage: null,
        lowerBodyCoverage: null,
        minimumMeanKneeAngleDeg: null,
        kneeExtensionRangeDeg: null,
        hipVerticalRangeTorsoUnits: null,
        landingTrunkTiltDeg: null,
      }),
    );
  });

  it("returns the immutable first result on an idempotent retry", async () => {
    const { saver, insertMeasurement, findOwnedMeasurementByVideoId } = setup();
    const original = savedMeasurement({
      id: "33333333-3333-4333-8333-333333333333",
      videoId,
      status: "CANCELED",
      qualityReasons: [],
      errorCode: null,
      algorithmVersion: POSE_LANDMARKER_CONFIG.algorithmVersion,
      tasksVisionVersion: POSE_LANDMARKER_CONFIG.tasksVisionVersion,
      modelSha256: POSE_LANDMARKER_CONFIG.model.sha256,
      sampleRateFps: POSE_LANDMARKER_CONFIG.sampleRateFps,
      delegate: POSE_LANDMARKER_CONFIG.delegate,
      runtimeFamily: "CHROMIUM",
      frameCount: null,
      poseFrameCount: null,
      lowerBodyFrameCount: null,
      poseCoverage: null,
      lowerBodyCoverage: null,
      minimumMeanKneeAngleDeg: null,
      kneeExtensionRangeDeg: null,
      hipVerticalRangeTorsoUnits: null,
      landingTrunkTiltDeg: null,
      processingDurationMs: 100,
      completedAt,
    });
    insertMeasurement.mockResolvedValue(null);
    findOwnedMeasurementByVideoId.mockResolvedValue(original);

    await expect(saver(completedInput())).resolves.toEqual({
      outcome: "ALREADY_EXISTS",
      measurement: original,
    });
    expect(findOwnedMeasurementByVideoId).toHaveBeenCalledWith({
      userId: "owner-user",
      videoId,
    });
  });
});
