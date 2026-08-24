import "server-only";

import { and, eq, exists, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { analyses, practiceSessions, videos } from "@/lib/db/schema";
import { reportApplicationWarning } from "@/lib/observability/application-log";

import {
  createOwnedAnalysisStatusReader,
  type AnalysisStatusStore,
} from "./analysis-status-core";

function ownedAnalysisScope(userId: string) {
  return db
    .select({ id: videos.id })
    .from(videos)
    .innerJoin(
      practiceSessions,
      eq(practiceSessions.id, videos.sessionId),
    )
    .where(
      and(
        eq(videos.id, analyses.videoId),
        eq(practiceSessions.userId, userId),
      ),
    );
}

const analysisStatusStore: AnalysisStatusStore = {
  async findOwnedAnalysis(input) {
    const [analysis] = await db
      .select({
        id: analyses.id,
        status: analyses.status,
        startedAt: analyses.startedAt,
        errorCode: analyses.errorCode,
      })
      .from(analyses)
      .innerJoin(videos, eq(videos.id, analyses.videoId))
      .innerJoin(
        practiceSessions,
        eq(practiceSessions.id, videos.sessionId),
      )
      .where(
        and(
          eq(analyses.id, input.analysisId),
          eq(practiceSessions.userId, input.userId),
        ),
      )
      .limit(1);

    return analysis ?? null;
  },

  async failOwnedStuckAnalysis(input) {
    const [failed] = await db
      .update(analyses)
      .set({
        status: "FAILED",
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        completedAt: input.completedAt,
      })
      .where(
        and(
          eq(analyses.id, input.analysisId),
          eq(analyses.status, "ANALYZING"),
          lt(analyses.startedAt, input.startedBefore),
          exists(ownedAnalysisScope(input.userId)),
        ),
      )
      .returning({
        id: analyses.id,
        status: analyses.status,
        startedAt: analyses.startedAt,
        errorCode: analyses.errorCode,
      });

    return failed ?? null;
  },
};

export const getOwnedAnalysisStatus = createOwnedAnalysisStatusReader({
  store: analysisStatusStore,
  now: () => new Date(),
  reportStuckAnalysis(input) {
    reportApplicationWarning({
      event: "analysis.stuck_detected",
      context: input,
    });
  },
});
