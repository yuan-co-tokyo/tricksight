import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { practiceSessions, videos } from "@/lib/db/schema";
import {
  createCompleteUploadService,
  type CompleteUploadStore,
} from "@/lib/uploads/complete-upload-core";
import { uploadObjectStore } from "@/lib/uploads/upload-object-store";

const completeUploadStore: CompleteUploadStore = {
  async findOwnedVideo(input) {
    const [record] = await db
      .select({
        id: videos.id,
        sessionId: videos.sessionId,
        s3Key: videos.s3Key,
        contentType: videos.contentType,
        fileSize: videos.fileSize,
        status: videos.status,
      })
      .from(videos)
      .innerJoin(
        practiceSessions,
        eq(practiceSessions.id, videos.sessionId),
      )
      .where(
        and(
          eq(practiceSessions.userId, input.userId),
          eq(practiceSessions.id, input.sessionId),
          eq(videos.id, input.videoId),
        ),
      )
      .limit(1);

    return record ?? null;
  },

  async transitionPendingToUploaded(videoId) {
    const [updated] = await db
      .update(videos)
      .set({ status: "UPLOADED" })
      .where(
        and(
          eq(videos.id, videoId),
          eq(videos.status, "PENDING_UPLOAD"),
        ),
      )
      .returning({ status: videos.status });

    if (updated) {
      return { status: updated.status, updated: true };
    }

    const [current] = await db
      .select({ status: videos.status })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1);

    return { status: current?.status ?? null, updated: false };
  },

  async markPendingAsFailed(videoId) {
    await db
      .update(videos)
      .set({ status: "FAILED" })
      .where(
        and(
          eq(videos.id, videoId),
          eq(videos.status, "PENDING_UPLOAD"),
        ),
      );
  },
};

export const completeVideoUpload = createCompleteUploadService({
  store: completeUploadStore,
  objects: uploadObjectStore,
});
