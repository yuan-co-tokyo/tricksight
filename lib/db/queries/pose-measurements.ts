import "server-only";

import {
  buildPoseHistoryComparisonState,
  type CurrentPoseComparisonConditions,
  type PoseComparisonCandidate,
  type PoseHistoryComparisonState,
} from "../../pose/history-comparison";
import { db } from "../index";
import {
  buildLatestPreviousPoseMeasurementQuery,
  buildPoseMeasurementByVideoQuery,
  buildPreviousMatchingPoseMeasurementQuery,
} from "./pose-measurement-builders";

export async function getPoseMeasurement(userId: string, videoId: string) {
  const [row] = await buildPoseMeasurementByVideoQuery(db, userId, videoId);

  return row?.measurement ?? null;
}

type PoseHistorySession = {
  practicedAt: Date;
  createdAt: Date;
  trickId: string;
  videoSpeed: "NORMAL" | "SLOW_MOTION" | null;
  cameraAngle: "SIDE" | "FRONT" | "REAR" | "DIAGONAL";
  videoId: string | null;
};

function toComparisonCandidate(
  row:
    | Awaited<ReturnType<typeof buildLatestPreviousPoseMeasurementQuery>>[number]
    | undefined,
): PoseComparisonCandidate | null {
  if (
    !row ||
    row.minimumMeanKneeAngleDeg === null ||
    row.hipVerticalRangeTorsoUnits === null
  ) {
    return null;
  }

  return {
    ...row,
    minimumMeanKneeAngleDeg: row.minimumMeanKneeAngleDeg,
    hipVerticalRangeTorsoUnits: row.hipVerticalRangeTorsoUnits,
  };
}

export async function getPoseHistoryComparison(
  userId: string,
  session: PoseHistorySession,
): Promise<PoseHistoryComparisonState> {
  if (!session.videoId) {
    return {
      kind: "unassessable",
      status: "MISSING",
      qualityReasons: [],
    };
  }

  const measurement = await getPoseMeasurement(userId, session.videoId);

  if (!measurement || measurement.status !== "COMPLETED") {
    return {
      kind: "unassessable",
      status: measurement?.status ?? "MISSING",
      qualityReasons: measurement?.qualityReasons ?? [],
    };
  }

  const currentConditions: CurrentPoseComparisonConditions = {
    videoSpeed: session.videoSpeed,
    cameraAngle: session.cameraAngle,
    algorithmVersion: measurement.algorithmVersion,
    modelSha256: measurement.modelSha256,
    sampleRateFps: measurement.sampleRateFps,
    delegate: measurement.delegate,
    runtimeFamily: measurement.runtimeFamily,
  };
  const previousConditions = {
    currentPracticedAt: session.practicedAt,
    currentCreatedAt: session.createdAt,
    trickId: session.trickId,
  };
  const latestSameTrickPromise = buildLatestPreviousPoseMeasurementQuery(
    db,
    userId,
    previousConditions,
  );
  const matchingPreviousPromise = session.videoSpeed
    ? buildPreviousMatchingPoseMeasurementQuery(db, userId, {
        ...previousConditions,
        videoSpeed: session.videoSpeed,
        cameraAngle: session.cameraAngle,
        algorithmVersion: measurement.algorithmVersion,
        modelSha256: measurement.modelSha256,
        sampleRateFps: measurement.sampleRateFps,
        delegate: measurement.delegate,
        runtimeFamily: measurement.runtimeFamily,
      })
    : Promise.resolve([]);
  const [[matchingPrevious], [latestSameTrick]] = await Promise.all([
    matchingPreviousPromise,
    latestSameTrickPromise,
  ]);

  return buildPoseHistoryComparisonState({
    measurement,
    currentConditions,
    matchingPrevious: toComparisonCandidate(matchingPrevious),
    latestSameTrick: toComparisonCandidate(latestSameTrick),
  });
}
