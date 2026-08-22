import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, exists } from "drizzle-orm";

import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { practiceSessions, tricks, videos } from "@/lib/db/schema";

import {
  createPendingUploadCreator,
  type PendingUploadStore,
} from "./pending-upload-core";

const pendingUploadStore: PendingUploadStore = {
  transaction(operation) {
    return db.transaction(async (tx) =>
      operation({
        async findActiveTrick(trickId) {
          const [trick] = await tx
            .select({ id: tricks.id })
            .from(tricks)
            .where(and(eq(tricks.id, trickId), eq(tricks.isActive, true)))
            .limit(1)
            .for("share");

          return trick ?? null;
        },
        async insertSession(values) {
          await tx.insert(practiceSessions).values(values);
        },
        async insertVideo(values) {
          await tx.insert(videos).values(values);
        },
      }),
    );
  },
};

export const createPendingUpload = createPendingUploadCreator({
  resolveCurrentUser: getCurrentUser,
  store: pendingUploadStore,
  createId: randomUUID,
  now: () => new Date(),
});

export async function deletePendingUpload(input: {
  userId: string;
  sessionId: string;
  videoId: string;
}) {
  const matchingPendingVideo = db
    .select({ id: videos.id })
    .from(videos)
    .where(
      and(
        eq(videos.id, input.videoId),
        eq(videos.sessionId, input.sessionId),
        eq(videos.status, "PENDING_UPLOAD"),
      ),
    );

  const deletedSessions = await db
    .delete(practiceSessions)
    .where(
      and(
        eq(practiceSessions.id, input.sessionId),
        eq(practiceSessions.userId, input.userId),
        exists(matchingPendingVideo),
      ),
    )
    .returning({ id: practiceSessions.id });

  // videos.session_id has ON DELETE CASCADE, so both rows disappear atomically.
  return deletedSessions.length === 1;
}

export {
  MAX_VIDEO_FILE_SIZE,
  PendingUploadCreationError,
  allowedVideoContentTypes,
  createPendingUploadInputSchema,
  type AllowedVideoContentType,
  type CameraAngle,
  type CreatePendingUploadInput,
  type CreatePendingUploadResult,
  type UserOutcome,
} from "./pending-upload-core";
