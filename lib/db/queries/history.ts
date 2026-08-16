import "server-only";

import { db } from "../index";

import {
  assembleDashboardSummary,
  buildActiveTricksQuery,
  buildDashboardLatestAnalysisQuery,
  buildDashboardLatestCompletedAnalysisQuery,
  buildDashboardRecentVideosQuery,
  buildDashboardTrickCountsQuery,
  buildPracticeSessionDetailQuery,
  buildPracticeSessionListQuery,
  type DashboardQueryOptions,
  type PracticeSessionListOptions,
} from "./history-builders";

export async function listActiveTricks(userId: string) {
  return buildActiveTricksQuery(db, userId);
}

export async function listPracticeSessions(
  userId: string,
  options: PracticeSessionListOptions = {},
) {
  return buildPracticeSessionListQuery(db, userId, options);
}

export async function getPracticeSessionDetail(
  userId: string,
  sessionId: string,
) {
  const [session] = await buildPracticeSessionDetailQuery(
    db,
    userId,
    sessionId,
  );

  return session ?? null;
}

export async function getDashboardSummary(
  userId: string,
  options: DashboardQueryOptions = {},
) {
  const [
    latestAnalyses,
    latestCompletedAnalyses,
    recentVideos,
    trickCounts,
  ] = await Promise.all([
    buildDashboardLatestAnalysisQuery(db, userId),
    buildDashboardLatestCompletedAnalysisQuery(db, userId),
    buildDashboardRecentVideosQuery(db, userId, options),
    buildDashboardTrickCountsQuery(db, userId),
  ]);

  return assembleDashboardSummary({
    latestAnalyses,
    latestCompletedAnalyses,
    recentVideos,
    trickCounts,
  });
}

export type { DashboardQueryOptions, PracticeSessionListOptions };
