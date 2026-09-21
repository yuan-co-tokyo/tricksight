import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { getCurrentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { ownerScope } from "@/lib/db/owner-scope";
import {
  poseMeasurements,
  practiceSessions,
  videos,
} from "@/lib/db/schema";

import {
  createPoseMeasurementSaver,
  type PoseMeasurementStore,
} from "./pose-measurement-core";

const poseMeasurementStore: PoseMeasurementStore = {
  transaction(operation) {
    return db.transaction(async (tx) =>
      operation({
        async findOwnedVideo(input) {
          const [video] = await tx
            .select({ id: videos.id })
            .from(videos)
            .innerJoin(
              practiceSessions,
              eq(practiceSessions.id, videos.sessionId),
            )
            .where(
              and(eq(videos.id, input.videoId), ownerScope(input.userId)),
            )
            .limit(1)
            .for("share");

          return video ?? null;
        },

        async insertMeasurement(values) {
          const [measurement] = await tx
            .insert(poseMeasurements)
            .values(values)
            .onConflictDoNothing({ target: poseMeasurements.videoId })
            .returning();

          return measurement ?? null;
        },

        async findOwnedMeasurementByVideoId(input) {
          const [measurement] = await tx
            .select({ measurement: poseMeasurements })
            .from(poseMeasurements)
            .innerJoin(videos, eq(videos.id, poseMeasurements.videoId))
            .innerJoin(
              practiceSessions,
              eq(practiceSessions.id, videos.sessionId),
            )
            .where(
              and(
                eq(poseMeasurements.videoId, input.videoId),
                ownerScope(input.userId),
              ),
            )
            .limit(1);

          return measurement?.measurement ?? null;
        },
      }),
    );
  },
};

export const savePoseMeasurement = createPoseMeasurementSaver({
  resolveCurrentUser: getCurrentUser,
  store: poseMeasurementStore,
  createId: randomUUID,
  now: () => new Date(),
});

export {
  MAX_POSE_FRAME_COUNT,
  PoseMeasurementSaveError,
  savePoseMeasurementInputSchema,
  type SavePoseMeasurementInput,
} from "./pose-measurement-core";
