import { z } from "zod";

import { POSE_LANDMARKER_CONFIG } from "../../pose/config";
import type { PoseQualityReason } from "../../pose/types";
import { MAX_VIDEO_DURATION_SECONDS } from "../../uploads/video-constraints";

import type { poseMeasurements } from "../schema";

type PoseMeasurementInsert = typeof poseMeasurements.$inferInsert;
type PoseMeasurementSelect = typeof poseMeasurements.$inferSelect;

export const MAX_POSE_FRAME_COUNT =
  MAX_VIDEO_DURATION_SECONDS * POSE_LANDMARKER_CONFIG.sampleRateFps;

const finiteNumber = z.number().finite();
const COVERAGE_TOLERANCE = 1e-12;
const processingDurationSchema = z
  .number()
  .int()
  .nonnegative()
  .max(POSE_LANDMARKER_CONFIG.defaultTimeoutMs)
  .nullable();
const coverageSchema = finiteNumber.min(0).max(1);
const qualityReasonSchema = z.enum([
  "POSE_COVERAGE_BELOW_THRESHOLD",
  "LOWER_BODY_COVERAGE_BELOW_THRESHOLD",
]);
const qualitySchema = z.strictObject({
  frameCount: z.number().int().positive().max(MAX_POSE_FRAME_COUNT),
  poseFrameCount: z.number().int().nonnegative().max(MAX_POSE_FRAME_COUNT),
  lowerBodyFrameCount: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_POSE_FRAME_COUNT),
  poseCoverage: coverageSchema,
  lowerBodyCoverage: coverageSchema,
  reasons: z.array(qualityReasonSchema).max(2),
});
const metricsSchema = z.strictObject({
  minimumMeanKneeAngleDeg: finiteNumber.min(0).max(180).nullable(),
  kneeExtensionRangeDeg: finiteNumber.min(0).max(180).nullable(),
  hipVerticalRangeTorsoUnits: finiteNumber.min(0).max(10).nullable(),
  landingTrunkTiltDeg: finiteNumber.min(0).max(90).nullable(),
});

const measurementSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("COMPLETED"),
    quality: qualitySchema,
    metrics: metricsSchema,
    processingDurationMs: processingDurationSchema,
  }),
  z.strictObject({
    status: z.literal("UNASSESSABLE"),
    quality: qualitySchema,
    metrics: z.null(),
    processingDurationMs: processingDurationSchema,
  }),
  z.strictObject({
    status: z.literal("FAILED"),
    quality: z.null(),
    metrics: z.null(),
    errorCode: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Z0-9_]+$/),
    processingDurationMs: processingDurationSchema,
  }),
  z.strictObject({
    status: z.literal("TIMED_OUT"),
    quality: z.null(),
    metrics: z.null(),
    processingDurationMs: processingDurationSchema,
  }),
  z.strictObject({
    status: z.literal("CANCELED"),
    quality: z.null(),
    metrics: z.null(),
    processingDurationMs: processingDurationSchema,
  }),
]);

export const savePoseMeasurementInputSchema = z
  .strictObject({
    videoId: z.uuid(),
    runtimeFamily: z.enum(["WEBKIT", "CHROMIUM"]),
    measurement: measurementSchema,
  })
  .superRefine((input, context) => {
    const quality = input.measurement.quality;
    if (!quality) return;

    if (quality.poseFrameCount > quality.frameCount) {
      context.addIssue({
        code: "custom",
        path: ["measurement", "quality", "poseFrameCount"],
        message: "poseFrameCount must not exceed frameCount.",
      });
    }
    if (quality.lowerBodyFrameCount > quality.poseFrameCount) {
      context.addIssue({
        code: "custom",
        path: ["measurement", "quality", "lowerBodyFrameCount"],
        message: "lowerBodyFrameCount must not exceed poseFrameCount.",
      });
    }

    const poseCoverage = quality.poseFrameCount / quality.frameCount;
    const lowerBodyCoverage =
      quality.lowerBodyFrameCount / quality.frameCount;
    if (Math.abs(quality.poseCoverage - poseCoverage) > COVERAGE_TOLERANCE) {
      context.addIssue({
        code: "custom",
        path: ["measurement", "quality", "poseCoverage"],
        message: "poseCoverage must match poseFrameCount / frameCount.",
      });
    }
    if (
      Math.abs(quality.lowerBodyCoverage - lowerBodyCoverage) >
      COVERAGE_TOLERANCE
    ) {
      context.addIssue({
        code: "custom",
        path: ["measurement", "quality", "lowerBodyCoverage"],
        message:
          "lowerBodyCoverage must match lowerBodyFrameCount / frameCount.",
      });
    }

    const expectedReasons: PoseQualityReason[] = [];
    const thresholds = POSE_LANDMARKER_CONFIG.qualityThresholds;
    if (poseCoverage < thresholds.poseCoverage) {
      expectedReasons.push("POSE_COVERAGE_BELOW_THRESHOLD");
    }
    if (lowerBodyCoverage < thresholds.lowerBodyCoverage) {
      expectedReasons.push("LOWER_BODY_COVERAGE_BELOW_THRESHOLD");
    }
    const reasonsMatch =
      quality.reasons.length === expectedReasons.length &&
      quality.reasons.every((reason, index) => reason === expectedReasons[index]);
    if (!reasonsMatch) {
      context.addIssue({
        code: "custom",
        path: ["measurement", "quality", "reasons"],
        message: "quality reasons must match the server-calculated coverage.",
      });
    }

    const expectedStatus =
      expectedReasons.length === 0 ? "COMPLETED" : "UNASSESSABLE";
    if (input.measurement.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        path: ["measurement", "status"],
        message: `status must be ${expectedStatus} for the supplied counts.`,
      });
    }
  });

export type SavePoseMeasurementInput = z.input<
  typeof savePoseMeasurementInputSchema
>;

export type PoseMeasurementInsertValues = Pick<
  PoseMeasurementInsert,
  | "id"
  | "videoId"
  | "status"
  | "qualityReasons"
  | "errorCode"
  | "algorithmVersion"
  | "tasksVisionVersion"
  | "modelSha256"
  | "sampleRateFps"
  | "delegate"
  | "runtimeFamily"
  | "frameCount"
  | "poseFrameCount"
  | "lowerBodyFrameCount"
  | "poseCoverage"
  | "lowerBodyCoverage"
  | "minimumMeanKneeAngleDeg"
  | "kneeExtensionRangeDeg"
  | "hipVerticalRangeTorsoUnits"
  | "landingTrunkTiltDeg"
  | "processingDurationMs"
  | "completedAt"
>;

export type SavedPoseMeasurement = PoseMeasurementSelect;

export interface PoseMeasurementTransaction {
  findOwnedVideo(input: {
    userId: string;
    videoId: string;
  }): Promise<{ id: string } | null>;
  insertMeasurement(
    values: PoseMeasurementInsertValues,
  ): Promise<SavedPoseMeasurement | null>;
  findOwnedMeasurementByVideoId(input: {
    userId: string;
    videoId: string;
  }): Promise<SavedPoseMeasurement | null>;
}

export interface PoseMeasurementStore {
  transaction<T>(
    operation: (transaction: PoseMeasurementTransaction) => Promise<T>,
  ): Promise<T>;
}

export type PoseMeasurementSaverDependencies = {
  resolveCurrentUser(): Promise<{ id: string } | null>;
  store: PoseMeasurementStore;
  createId(): string;
  now(): Date;
};

export type PoseMeasurementSaveErrorCode =
  | "UNAUTHENTICATED"
  | "VIDEO_NOT_FOUND"
  | "CONCURRENT_STATE_CHANGED";

export class PoseMeasurementSaveError extends Error {
  constructor(
    readonly code: PoseMeasurementSaveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PoseMeasurementSaveError";
  }
}

function measurementValues(
  parsed: z.output<typeof savePoseMeasurementInputSchema>,
  dependencies: Pick<PoseMeasurementSaverDependencies, "createId" | "now">,
): PoseMeasurementInsertValues {
  const { measurement } = parsed;
  const quality = measurement.quality;
  const metrics = measurement.metrics;

  return {
    id: dependencies.createId(),
    videoId: parsed.videoId,
    status: measurement.status,
    qualityReasons: quality?.reasons ?? [],
    errorCode: measurement.status === "FAILED" ? measurement.errorCode : null,
    algorithmVersion: POSE_LANDMARKER_CONFIG.algorithmVersion,
    tasksVisionVersion: POSE_LANDMARKER_CONFIG.tasksVisionVersion,
    modelSha256: POSE_LANDMARKER_CONFIG.model.sha256,
    sampleRateFps: POSE_LANDMARKER_CONFIG.sampleRateFps,
    delegate: POSE_LANDMARKER_CONFIG.delegate,
    runtimeFamily: parsed.runtimeFamily,
    frameCount: quality?.frameCount ?? null,
    poseFrameCount: quality?.poseFrameCount ?? null,
    lowerBodyFrameCount: quality?.lowerBodyFrameCount ?? null,
    poseCoverage: quality
      ? quality.poseFrameCount / quality.frameCount
      : null,
    lowerBodyCoverage: quality
      ? quality.lowerBodyFrameCount / quality.frameCount
      : null,
    minimumMeanKneeAngleDeg: metrics?.minimumMeanKneeAngleDeg ?? null,
    kneeExtensionRangeDeg: metrics?.kneeExtensionRangeDeg ?? null,
    hipVerticalRangeTorsoUnits:
      metrics?.hipVerticalRangeTorsoUnits ?? null,
    landingTrunkTiltDeg: metrics?.landingTrunkTiltDeg ?? null,
    processingDurationMs: measurement.processingDurationMs,
    completedAt: dependencies.now(),
  };
}

export function createPoseMeasurementSaver(
  dependencies: PoseMeasurementSaverDependencies,
) {
  return async function savePoseMeasurement(input: unknown) {
    const currentUser = await dependencies.resolveCurrentUser();
    if (!currentUser) {
      throw new PoseMeasurementSaveError(
        "UNAUTHENTICATED",
        "An authenticated session is required.",
      );
    }

    const parsed = savePoseMeasurementInputSchema.parse(input);
    return dependencies.store.transaction(async (transaction) => {
      const video = await transaction.findOwnedVideo({
        userId: currentUser.id,
        videoId: parsed.videoId,
      });
      if (!video) {
        throw new PoseMeasurementSaveError(
          "VIDEO_NOT_FOUND",
          "The selected video does not exist for the current user.",
        );
      }

      const inserted = await transaction.insertMeasurement(
        measurementValues(parsed, dependencies),
      );
      if (inserted) return { outcome: "CREATED" as const, measurement: inserted };

      // The first terminal result is immutable. This makes network retries
      // idempotent and prevents a late cancel or another runtime family from
      // overwriting the comparison baseline for the video.
      const existing = await transaction.findOwnedMeasurementByVideoId({
        userId: currentUser.id,
        videoId: video.id,
      });
      if (existing) {
        return {
          outcome: "ALREADY_EXISTS" as const,
          measurement: existing,
        };
      }

      throw new PoseMeasurementSaveError(
        "CONCURRENT_STATE_CHANGED",
        "The pose measurement changed while saving.",
      );
    });
  };
}
