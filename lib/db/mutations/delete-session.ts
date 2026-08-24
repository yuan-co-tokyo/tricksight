import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  analyses,
  practiceSessions,
  videos,
} from "@/lib/db/schema";
import {
  createSessionDeletionService,
  type SessionDeletionStore,
} from "@/lib/session-deletion/session-deletion-core";
import { uploadObjectStore } from "@/lib/uploads/upload-object-store";

const sessionDeletionStore: SessionDeletionStore = {
  transaction(operation) {
    return db.transaction(async (tx) =>
      operation({
        async findOwnedSessionForDeletion(input) {
          // 所有者sessionを先にロックし、分析開始・重複削除との競合を直列化する。
          const [ownedSession] = await tx
            .select({ id: practiceSessions.id })
            .from(practiceSessions)
            .where(
              and(
                eq(practiceSessions.id, input.sessionId),
                eq(practiceSessions.userId, input.userId),
              ),
            )
            .limit(1)
            .for("update");

          if (!ownedSession) return null;

          const [video] = await tx
            .select({
              id: videos.id,
              s3Key: videos.s3Key,
            })
            .from(videos)
            .where(eq(videos.sessionId, ownedSession.id))
            .limit(1)
            .for("update");

          const [inProgressAnalysis] = video
            ? await tx
                .select({
                  id: analyses.id,
                  status: analyses.status,
                })
                .from(analyses)
                .where(
                  and(
                    eq(analyses.videoId, video.id),
                    inArray(analyses.status, ["QUEUED", "ANALYZING"]),
                  ),
                )
                .limit(1)
                .for("update")
            : [];

          let normalizedInProgressAnalysis = null;

          if (inProgressAnalysis) {
            if (
              inProgressAnalysis.status !== "QUEUED" &&
              inProgressAnalysis.status !== "ANALYZING"
            ) {
              throw new Error("Unexpected in-progress analysis status.");
            }

            normalizedInProgressAnalysis = {
              id: inProgressAnalysis.id,
              status: inProgressAnalysis.status,
            };
          }

          return {
            id: ownedSession.id,
            video: video ?? null,
            inProgressAnalysis: normalizedInProgressAnalysis,
          };
        },

        async deleteOwnedSession(input) {
          const [deleted] = await tx
            .delete(practiceSessions)
            .where(
              and(
                eq(practiceSessions.id, input.sessionId),
                eq(practiceSessions.userId, input.userId),
              ),
            )
            .returning({ id: practiceSessions.id });

          return deleted !== undefined;
        },
      }),
    );
  },
};

export const deletePracticeSession = createSessionDeletionService({
  store: sessionDeletionStore,
  objects: uploadObjectStore,
});
