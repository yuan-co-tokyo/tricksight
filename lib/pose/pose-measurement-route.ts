import { z } from "zod";

import {
  PoseMeasurementSaveError,
  type SavedPoseMeasurement,
} from "../db/mutations/pose-measurement-core";
import { createUnexpectedErrorReporter } from "../observability/application-log";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

type SaveResult = {
  outcome: "CREATED" | "ALREADY_EXISTS";
  measurement: SavedPoseMeasurement;
};

type Dependencies = {
  savePoseMeasurement(input: unknown): Promise<SaveResult>;
  reportUnexpectedError?(error: unknown): void;
};

function errorResponse(code: string, status: number) {
  return Response.json(
    { error: { code } },
    { status, headers: NO_STORE_HEADERS },
  );
}

export function createPoseMeasurementRouteHandler(dependencies: Dependencies) {
  const reportUnexpectedError = createUnexpectedErrorReporter({
    event: "pose.measurement.save_failed",
    reporter: dependencies.reportUnexpectedError,
  });

  return async function POST(request: Request) {
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return errorResponse("INVALID_REQUEST", 400);
    }

    try {
      const result = await dependencies.savePoseMeasurement(input);
      return Response.json(
        { outcome: result.outcome },
        {
          status: result.outcome === "CREATED" ? 201 : 200,
          headers: NO_STORE_HEADERS,
        },
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        return errorResponse("INVALID_REQUEST", 400);
      }
      if (error instanceof PoseMeasurementSaveError) {
        if (error.code === "UNAUTHENTICATED") {
          return errorResponse("UNAUTHENTICATED", 401);
        }
        if (error.code === "VIDEO_NOT_FOUND") {
          return errorResponse("VIDEO_NOT_FOUND", 404);
        }
        return errorResponse("POSE_MEASUREMENT_CONFLICT", 409);
      }

      reportUnexpectedError(error);
      return errorResponse("POSE_MEASUREMENT_SAVE_FAILED", 500);
    }
  };
}
