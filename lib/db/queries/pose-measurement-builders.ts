import { and, eq } from "drizzle-orm";

import { ownerScope } from "../owner-scope";
import { poseMeasurements, practiceSessions, videos } from "../schema";
import type { HistoryDatabase } from "./history-builders";

/**
 * pose_measurements does not carry user_id, so every read must traverse the
 * canonical videos -> sessions ownership chain before applying ownerScope.
 */
export function buildPoseMeasurementByVideoQuery(
  database: HistoryDatabase,
  userId: string,
  videoId: string,
) {
  return database
    .select({ measurement: poseMeasurements })
    .from(poseMeasurements)
    .innerJoin(videos, eq(videos.id, poseMeasurements.videoId))
    .innerJoin(
      practiceSessions,
      eq(practiceSessions.id, videos.sessionId),
    )
    .where(
      and(eq(poseMeasurements.videoId, videoId), ownerScope(userId)),
    )
    .limit(1);
}
