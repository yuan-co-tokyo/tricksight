import { and, count, desc, eq, exists, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../schema";
import {
  analyses,
  practiceSessions,
  tricks,
  user,
  videos,
} from "../schema";

export type HistoryDatabase = NodePgDatabase<typeof schema>;

export type PracticeSessionListOptions = {
  trickSlug?: string;
};

export type DashboardQueryOptions = {
  recentVideoLimit?: number;
};

function requireUserId(userId: string) {
  if (userId.trim().length === 0) {
    throw new Error("userId is required for every history query.");
  }

  return userId;
}

function ownerScope(userId: string) {
  return eq(practiceSessions.userId, requireUserId(userId));
}

/**
 * Analyses do not carry a user ID. Keeping this join chain in one helper makes
 * it impossible for list/detail/dashboard builders to read an analysis without
 * traversing videos -> sessions and applying the owner scope first.
 */
function buildLatestOwnedAnalysisSubquery(
  database: HistoryDatabase,
  userId: string,
) {
  return database
    .select({
      id: analyses.id,
      videoId: analyses.videoId,
      provider: analyses.provider,
      modelId: analyses.modelId,
      promptVersion: analyses.promptVersion,
      status: analyses.status,
      resultJson: analyses.resultJson,
      errorCode: analyses.errorCode,
      attemptCount: analyses.attemptCount,
      startedAt: analyses.startedAt,
      completedAt: analyses.completedAt,
      createdAt: analyses.createdAt,
      rank: sql<number>`row_number() over (
        partition by ${analyses.videoId}
        order by ${analyses.createdAt} desc, ${analyses.id} desc
      )`.as("analysis_rank"),
    })
    .from(analyses)
    .innerJoin(videos, eq(videos.id, analyses.videoId))
    .innerJoin(
      practiceSessions,
      eq(practiceSessions.id, videos.sessionId),
    )
    .where(ownerScope(userId))
    .as("latest_owned_analysis");
}

export function buildActiveTricksQuery(
  database: HistoryDatabase,
  userId: string,
) {
  const userExists = database
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, requireUserId(userId)));

  return database
    .select({
      id: tricks.id,
      slug: tricks.slug,
      name: tricks.name,
      description: tricks.description,
    })
    .from(tricks)
    .where(and(eq(tricks.isActive, true), exists(userExists)))
    .orderBy(tricks.slug);
}

export function buildPracticeSessionListQuery(
  database: HistoryDatabase,
  userId: string,
  options: PracticeSessionListOptions = {},
) {
  const latestAnalysis = buildLatestOwnedAnalysisSubquery(database, userId);
  const filters = [ownerScope(userId)];

  if (options.trickSlug) {
    filters.push(eq(tricks.slug, options.trickSlug));
  }

  return database
    .select({
      id: practiceSessions.id,
      practicedAt: practiceSessions.practicedAt,
      cameraAngle: practiceSessions.cameraAngle,
      userOutcome: practiceSessions.userOutcome,
      memo: practiceSessions.memo,
      createdAt: practiceSessions.createdAt,
      trick: {
        id: tricks.id,
        slug: tricks.slug,
        name: tricks.name,
      },
      video: {
        id: videos.id,
        originalFilename: videos.originalFilename,
        contentType: videos.contentType,
        durationMs: videos.durationMs,
        width: videos.width,
        height: videos.height,
        status: videos.status,
        createdAt: videos.createdAt,
      },
      latestAnalysis: {
        id: latestAnalysis.id,
        status: latestAnalysis.status,
        resultJson: latestAnalysis.resultJson,
        completedAt: latestAnalysis.completedAt,
        createdAt: latestAnalysis.createdAt,
      },
    })
    .from(practiceSessions)
    .innerJoin(tricks, eq(tricks.id, practiceSessions.trickId))
    .leftJoin(videos, eq(videos.sessionId, practiceSessions.id))
    .leftJoin(
      latestAnalysis,
      and(
        eq(latestAnalysis.videoId, videos.id),
        eq(latestAnalysis.rank, 1),
      ),
    )
    .where(and(...filters))
    .orderBy(desc(practiceSessions.practicedAt), desc(practiceSessions.id));
}

export function buildPracticeSessionDetailQuery(
  database: HistoryDatabase,
  userId: string,
  sessionId: string,
) {
  const latestAnalysis = buildLatestOwnedAnalysisSubquery(database, userId);

  return database
    .select({
      id: practiceSessions.id,
      practicedAt: practiceSessions.practicedAt,
      cameraAngle: practiceSessions.cameraAngle,
      userOutcome: practiceSessions.userOutcome,
      memo: practiceSessions.memo,
      createdAt: practiceSessions.createdAt,
      updatedAt: practiceSessions.updatedAt,
      trick: {
        id: tricks.id,
        slug: tricks.slug,
        name: tricks.name,
        description: tricks.description,
      },
      video: {
        id: videos.id,
        s3Key: videos.s3Key,
        originalFilename: videos.originalFilename,
        contentType: videos.contentType,
        fileSize: videos.fileSize,
        durationMs: videos.durationMs,
        width: videos.width,
        height: videos.height,
        status: videos.status,
        createdAt: videos.createdAt,
      },
      latestAnalysis: {
        id: latestAnalysis.id,
        provider: latestAnalysis.provider,
        modelId: latestAnalysis.modelId,
        promptVersion: latestAnalysis.promptVersion,
        status: latestAnalysis.status,
        resultJson: latestAnalysis.resultJson,
        errorCode: latestAnalysis.errorCode,
        attemptCount: latestAnalysis.attemptCount,
        startedAt: latestAnalysis.startedAt,
        completedAt: latestAnalysis.completedAt,
        createdAt: latestAnalysis.createdAt,
      },
    })
    .from(practiceSessions)
    .innerJoin(tricks, eq(tricks.id, practiceSessions.trickId))
    .leftJoin(videos, eq(videos.sessionId, practiceSessions.id))
    .leftJoin(
      latestAnalysis,
      and(
        eq(latestAnalysis.videoId, videos.id),
        eq(latestAnalysis.rank, 1),
      ),
    )
    .where(
      and(ownerScope(userId), eq(practiceSessions.id, sessionId)),
    )
    .limit(1);
}

export function buildDashboardLatestAnalysisQuery(
  database: HistoryDatabase,
  userId: string,
) {
  const latestAnalysis = buildLatestOwnedAnalysisSubquery(database, userId);

  return database
    .select({
      sessionId: practiceSessions.id,
      practicedAt: practiceSessions.practicedAt,
      trick: {
        slug: tricks.slug,
        name: tricks.name,
      },
      video: {
        id: videos.id,
        status: videos.status,
      },
      analysis: {
        id: latestAnalysis.id,
        status: latestAnalysis.status,
        resultJson: latestAnalysis.resultJson,
        completedAt: latestAnalysis.completedAt,
        createdAt: latestAnalysis.createdAt,
      },
    })
    .from(practiceSessions)
    .innerJoin(tricks, eq(tricks.id, practiceSessions.trickId))
    .innerJoin(videos, eq(videos.sessionId, practiceSessions.id))
    .innerJoin(
      latestAnalysis,
      and(
        eq(latestAnalysis.videoId, videos.id),
        eq(latestAnalysis.rank, 1),
      ),
    )
    .where(ownerScope(userId))
    .orderBy(desc(latestAnalysis.createdAt), desc(latestAnalysis.id))
    .limit(1);
}

/**
 * The status-agnostic latest analysis powers the dashboard's current-status
 * card. This separate COMPLETED-only query powers coaching content, so an
 * ANALYZING or FAILED latest attempt never hides the user's last valid advice.
 */
export function buildDashboardLatestCompletedAnalysisQuery(
  database: HistoryDatabase,
  userId: string,
) {
  return database
    .select({
      sessionId: practiceSessions.id,
      practicedAt: practiceSessions.practicedAt,
      trick: {
        slug: tricks.slug,
        name: tricks.name,
      },
      video: {
        id: videos.id,
        status: videos.status,
      },
      analysis: {
        id: analyses.id,
        status: analyses.status,
        resultJson: analyses.resultJson,
        completedAt: analyses.completedAt,
        createdAt: analyses.createdAt,
      },
    })
    .from(practiceSessions)
    .innerJoin(tricks, eq(tricks.id, practiceSessions.trickId))
    .innerJoin(videos, eq(videos.sessionId, practiceSessions.id))
    .innerJoin(analyses, eq(analyses.videoId, videos.id))
    .where(
      and(ownerScope(userId), eq(analyses.status, "COMPLETED")),
    )
    .orderBy(desc(analyses.createdAt), desc(analyses.id))
    .limit(1);
}

export function assembleDashboardSummary<
  TLatestAnalysis,
  TLatestCompletedAnalysis,
  TRecentVideo,
  TTrickCount,
>(input: {
  latestAnalyses: readonly TLatestAnalysis[];
  latestCompletedAnalyses: readonly TLatestCompletedAnalysis[];
  recentVideos: readonly TRecentVideo[];
  trickCounts: readonly TTrickCount[];
}) {
  return {
    // Status-agnostic: use this for the latest processing state card.
    latestAnalysis: input.latestAnalyses[0] ?? null,
    // COMPLETED-only: use this for durable coaching and improvements.
    latestCompletedAnalysis: input.latestCompletedAnalyses[0] ?? null,
    recentVideos: input.recentVideos,
    trickCounts: input.trickCounts,
  };
}

export function buildDashboardRecentVideosQuery(
  database: HistoryDatabase,
  userId: string,
  options: DashboardQueryOptions = {},
) {
  const limit = options.recentVideoLimit ?? 5;

  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("recentVideoLimit must be an integer between 1 and 20.");
  }

  return database
    .select({
      sessionId: practiceSessions.id,
      practicedAt: practiceSessions.practicedAt,
      userOutcome: practiceSessions.userOutcome,
      trick: {
        slug: tricks.slug,
        name: tricks.name,
      },
      video: {
        id: videos.id,
        originalFilename: videos.originalFilename,
        durationMs: videos.durationMs,
        status: videos.status,
        createdAt: videos.createdAt,
      },
    })
    .from(practiceSessions)
    .innerJoin(tricks, eq(tricks.id, practiceSessions.trickId))
    .innerJoin(videos, eq(videos.sessionId, practiceSessions.id))
    .where(ownerScope(userId))
    .orderBy(desc(videos.createdAt), desc(videos.id))
    .limit(limit);
}

export function buildDashboardTrickCountsQuery(
  database: HistoryDatabase,
  userId: string,
) {
  return database
    .select({
      trickId: tricks.id,
      trickSlug: tricks.slug,
      trickName: tricks.name,
      postCount: count(practiceSessions.id),
    })
    .from(practiceSessions)
    .innerJoin(tricks, eq(tricks.id, practiceSessions.trickId))
    .where(ownerScope(userId))
    .groupBy(tricks.id, tricks.slug, tricks.name)
    .orderBy(tricks.slug);
}
