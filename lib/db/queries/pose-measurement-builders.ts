import { and, desc, eq, isNotNull, lt, or } from "drizzle-orm";

import { ownerScope } from "../owner-scope";
import { poseMeasurements, practiceSessions, videos } from "../schema";
import type { HistoryDatabase } from "./history-builders";

export type PoseComparisonConditions = {
  currentPracticedAt: Date;
  currentCreatedAt: Date;
  trickId: string;
  videoSpeed: "NORMAL" | "SLOW_MOTION";
  cameraAngle: "SIDE" | "FRONT" | "REAR" | "DIAGONAL";
  algorithmVersion: string;
  modelSha256: string;
  sampleRateFps: number;
  delegate: string;
  runtimeFamily: string;
};

const previousPoseSelection = {
  sessionId: practiceSessions.id,
  practicedAt: practiceSessions.practicedAt,
  videoSpeed: practiceSessions.videoSpeed,
  cameraAngle: practiceSessions.cameraAngle,
  algorithmVersion: poseMeasurements.algorithmVersion,
  modelSha256: poseMeasurements.modelSha256,
  sampleRateFps: poseMeasurements.sampleRateFps,
  delegate: poseMeasurements.delegate,
  runtimeFamily: poseMeasurements.runtimeFamily,
  minimumMeanKneeAngleDeg:
    poseMeasurements.minimumMeanKneeAngleDeg,
  hipVerticalRangeTorsoUnits:
    poseMeasurements.hipVerticalRangeTorsoUnits,
};

function previousCompletedPoseFilters(
  userId: string,
  conditions: Pick<
    PoseComparisonConditions,
    "currentPracticedAt" | "currentCreatedAt" | "trickId"
  >,
) {
  return [
    ownerScope(userId),
    eq(practiceSessions.trickId, conditions.trickId),
    or(
      lt(practiceSessions.practicedAt, conditions.currentPracticedAt),
      and(
        eq(practiceSessions.practicedAt, conditions.currentPracticedAt),
        lt(practiceSessions.createdAt, conditions.currentCreatedAt),
      ),
    ),
    eq(poseMeasurements.status, "COMPLETED" as const),
    isNotNull(poseMeasurements.minimumMeanKneeAngleDeg),
    isNotNull(poseMeasurements.hipVerticalRangeTorsoUnits),
  ];
}

/**
 * pose_measurements does not carry user_id, so every read must traverse the
 * canonical videos -> sessions ownership chain before applying ownerScope.
 */
export function buildPoseMeasurementByVideoQuery(
  database: HistoryDatabase,
  userId: string,
  videoId: string,
) {
  return database
    .select({ measurement: poseMeasurements })
    .from(poseMeasurements)
    .innerJoin(videos, eq(videos.id, poseMeasurements.videoId))
    .innerJoin(
      practiceSessions,
      eq(practiceSessions.id, videos.sessionId),
    )
    .where(
      and(eq(poseMeasurements.videoId, videoId), ownerScope(userId)),
    )
    .limit(1);
}

/**
 * Finds the most recent earlier measurement only when all nine approved
 * comparison conditions match. ownerScope is the ownership condition;
 * userOutcome and tasksVisionVersion are intentionally not comparison keys.
 */
export function buildPreviousMatchingPoseMeasurementQuery(
  database: HistoryDatabase,
  userId: string,
  conditions: PoseComparisonConditions,
) {
  return database
    .select(previousPoseSelection)
    .from(poseMeasurements)
    .innerJoin(videos, eq(videos.id, poseMeasurements.videoId))
    .innerJoin(
      practiceSessions,
      eq(practiceSessions.id, videos.sessionId),
    )
    .where(
      and(
        ...previousCompletedPoseFilters(userId, conditions),
        eq(practiceSessions.videoSpeed, conditions.videoSpeed),
        eq(practiceSessions.cameraAngle, conditions.cameraAngle),
        eq(poseMeasurements.algorithmVersion, conditions.algorithmVersion),
        eq(poseMeasurements.modelSha256, conditions.modelSha256),
        eq(poseMeasurements.sampleRateFps, conditions.sampleRateFps),
        eq(poseMeasurements.delegate, conditions.delegate),
        eq(poseMeasurements.runtimeFamily, conditions.runtimeFamily),
      ),
    )
    .orderBy(
      desc(practiceSessions.practicedAt),
      desc(practiceSessions.createdAt),
      desc(practiceSessions.id),
    )
    .limit(1);
}

/**
 * Retrieves the latest usable measurement for the same trick so the UI can
 * explain why no strict comparison exists. It never supplies a delta itself.
 */
export function buildLatestPreviousPoseMeasurementQuery(
  database: HistoryDatabase,
  userId: string,
  conditions: Pick<
    PoseComparisonConditions,
    "currentPracticedAt" | "currentCreatedAt" | "trickId"
  >,
) {
  return database
    .select(previousPoseSelection)
    .from(poseMeasurements)
    .innerJoin(videos, eq(videos.id, poseMeasurements.videoId))
    .innerJoin(
      practiceSessions,
      eq(practiceSessions.id, videos.sessionId),
    )
    .where(and(...previousCompletedPoseFilters(userId, conditions)))
    .orderBy(
      desc(practiceSessions.practicedAt),
      desc(practiceSessions.createdAt),
      desc(practiceSessions.id),
    )
    .limit(1);
}
