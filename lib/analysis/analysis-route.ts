import { z } from "zod";

import {
  QueuedAnalysisCreationError,
  type CreateQueuedAnalysisResult,
} from "../db/mutations/queued-analysis-core";

import type { RunQueuedAnalysisResult } from "./run-queued-analysis-core";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

type Dependencies = {
  createQueuedAnalysis(input: unknown): Promise<CreateQueuedAnalysisResult>;
  runQueuedAnalysis(analysisId: string): Promise<RunQueuedAnalysisResult>;
  scheduleAfter(callback: () => Promise<void>): void;
  reportUnexpectedError?(error: unknown): void;
};

function errorResponse(code: string, status: number) {
  return Response.json(
    { error: { code } },
    { status, headers: NO_STORE_HEADERS },
  );
}

export function createAnalysisRouteHandler(dependencies: Dependencies) {
  const reportUnexpectedError =
    dependencies.reportUnexpectedError ??
    ((error: unknown) => {
      console.error("Failed to run queued video analysis.", error);
    });

  return async function POST(request: Request) {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return errorResponse("INVALID_REQUEST", 400);
    }

    try {
      const queued = await dependencies.createQueuedAnalysis(body);

      if (queued.analysis.status === "QUEUED") {
        dependencies.scheduleAfter(async () => {
          try {
            // after()がこのPromiseのsettleまで関数実行を延長する。
            await dependencies.runQueuedAnalysis(queued.analysis.id);
          } catch (error) {
            reportUnexpectedError(error);
          }
        });
      }

      return Response.json(
        {
          analysisId: queued.analysis.id,
          status: queued.analysis.status,
        },
        { status: 202, headers: NO_STORE_HEADERS },
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        return errorResponse("INVALID_REQUEST", 400);
      }

      if (error instanceof QueuedAnalysisCreationError) {
        switch (error.code) {
          case "UNAUTHENTICATED":
            return errorResponse("UNAUTHENTICATED", 401);
          case "VIDEO_NOT_FOUND":
            return errorResponse("VIDEO_NOT_FOUND", 404);
          case "VIDEO_NOT_READY":
            return errorResponse("VIDEO_NOT_READY", 409);
          case "PROMPT_UNAVAILABLE":
            return errorResponse("PROMPT_UNAVAILABLE", 422);
          case "CONCURRENT_STATE_CHANGED":
            return errorResponse("ANALYSIS_STATE_CHANGED", 409);
        }
      }

      reportUnexpectedError(error);
      return errorResponse("ANALYSIS_QUEUE_FAILED", 500);
    }
  };
}
