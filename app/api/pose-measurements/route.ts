import { savePoseMeasurement } from "@/lib/db/mutations/pose-measurement";
import { createPoseMeasurementRouteHandler } from "@/lib/pose/pose-measurement-route";

export const runtime = "nodejs";

export const POST = createPoseMeasurementRouteHandler({ savePoseMeasurement });
