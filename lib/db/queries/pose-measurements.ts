import "server-only";

import { db } from "../index";
import { buildPoseMeasurementByVideoQuery } from "./pose-measurement-builders";

export async function getPoseMeasurement(userId: string, videoId: string) {
  const [row] = await buildPoseMeasurementByVideoQuery(db, userId, videoId);

  return row?.measurement ?? null;
}
