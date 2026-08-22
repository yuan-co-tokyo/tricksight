import "server-only";

import { randomUUID } from "node:crypto";
import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { createVideoAnalysisProvider } from "@/lib/analysis/provider-factory";
import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import {
  analyses,
  practiceSessions,
  tricks,
  user,
  videos,
} from "@/lib/db/schema";
import { getPromptForTrick } from "@/prompts/common-system-v2";

import {
  createQueuedAnalysisCreator,
  type QueuedAnalysisStore,
} from "./queued-analysis-core";

const inProgressAnalysisPredicate = sql`${analyses.status} in ('QUEUED', 'ANALYZING')`;

const queuedAnalysisStore: QueuedAnalysisStore = {
  transaction(operation) {
    return db.transaction(async (tx) =>
      operation({
        async lockUserAnalysisQuota(userId) {
          const [lockedUser] = await tx
            .select({ id: user.id })
            .from(user)
            .where(eq(user.id, userId))
            .limit(1)
            .for("update");

          return lockedUser !== undefined;
        },

        async findOwnedVideo(input) {
          const [video] = await tx
            .select({
              id: videos.id,
              status: videos.status,
              trickSlug: tricks.slug,
              stance: user.stance,
            })
            .from(videos)
            .innerJoin(
              practiceSessions,
              eq(practiceSessions.id, videos.sessionId),
            )
            .innerJoin(tricks, eq(tricks.id, practiceSessions.trickId))
            .innerJoin(user, eq(user.id, practiceSessions.userId))
            .where(
              and(
                eq(videos.id, input.videoId),
                eq(practiceSessions.userId, input.userId),
              ),
            )
            .limit(1)
            .for("share");

          return video ?? null;
        },

        async countUserAnalysesInWindow(input) {
          const [result] = await tx
            .select({ value: count(analyses.id) })
            .from(analyses)
            .innerJoin(videos, eq(videos.id, analyses.videoId))
            .innerJoin(
              practiceSessions,
              eq(practiceSessions.id, videos.sessionId),
            )
            .where(
              and(
                eq(practiceSessions.userId, input.userId),
                gte(analyses.createdAt, input.startsAt),
                lt(analyses.createdAt, input.endsBefore),
              ),
            );

          return result?.value ?? 0;
        },

        async insertQueuedAnalysis(values) {
          const [inserted] = await tx
            .insert(analyses)
            .values(values)
            .onConflictDoNothing({
              target: analyses.videoId,
              where: inProgressAnalysisPredicate,
            })
            .returning({
              id: analyses.id,
              videoId: analyses.videoId,
              provider: analyses.provider,
              modelId: analyses.modelId,
              promptVersion: analyses.promptVersion,
              status: analyses.status,
            });

          if (
            !inserted ||
            (inserted.status !== "QUEUED" &&
              inserted.status !== "ANALYZING")
          ) {
            return null;
          }

          return { ...inserted, status: inserted.status };
        },

        async findInProgressAnalysis(videoId) {
          const [analysis] = await tx
            .select({
              id: analyses.id,
              videoId: analyses.videoId,
              provider: analyses.provider,
              modelId: analyses.modelId,
              promptVersion: analyses.promptVersion,
              status: analyses.status,
            })
            .from(analyses)
            .where(
              and(
                eq(analyses.videoId, videoId),
                inArray(analyses.status, ["QUEUED", "ANALYZING"]),
              ),
            )
            .limit(1);

          if (
            !analysis ||
            (analysis.status !== "QUEUED" &&
              analysis.status !== "ANALYZING")
          ) {
            return null;
          }

          return { ...analysis, status: analysis.status };
        },
      }),
    );
  },
};

export const createQueuedAnalysis = createQueuedAnalysisCreator({
  resolveCurrentUser: getCurrentUser,
  store: queuedAnalysisStore,
  createProvider: createVideoAnalysisProvider,
  resolvePromptVersion: (trickSlug) =>
    getPromptForTrick(trickSlug).version,
  createId: randomUUID,
  now: () => new Date(),
});

export {
  QueuedAnalysisCreationError,
  createQueuedAnalysisInputSchema,
  type CreateQueuedAnalysisInput,
  type CreateQueuedAnalysisResult,
} from "./queued-analysis-core";
