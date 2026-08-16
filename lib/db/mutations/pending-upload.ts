import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

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
