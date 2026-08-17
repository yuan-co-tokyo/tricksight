import { z } from "zod";

import {
  QueuedAnalysisCreationError,
  type CreateQueuedAnalysisResult,
} from "../db/mutations/queued-analysis-core";

import {
  ANALYSIS_REQUEST_ERRORS,
  type PublicAnalysisError,
} from "./analysis-public-error";
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

function errorResponse(error: PublicAnalysisError, status: number) {
  return Response.json(
    { error },
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
      return errorResponse(ANALYSIS_REQUEST_ERRORS.INVALID_REQUEST, 400);
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
        return errorResponse(ANALYSIS_REQUEST_ERRORS.INVALID_REQUEST, 400);
      }

      if (error instanceof QueuedAnalysisCreationError) {
        switch (error.code) {
          case "UNAUTHENTICATED":
            return errorResponse(ANALYSIS_REQUEST_ERRORS.UNAUTHENTICATED, 401);
          case "VIDEO_NOT_FOUND":
            return errorResponse(ANALYSIS_REQUEST_ERRORS.VIDEO_NOT_FOUND, 404);
          case "VIDEO_NOT_READY":
            return errorResponse(ANALYSIS_REQUEST_ERRORS.VIDEO_NOT_READY, 409);
          case "STANCE_REQUIRED":
            return errorResponse(ANALYSIS_REQUEST_ERRORS.STANCE_REQUIRED, 422);
          case "PROMPT_UNAVAILABLE":
            return errorResponse(ANALYSIS_REQUEST_ERRORS.ANALYSIS_UNAVAILABLE, 503);
          case "DAILY_LIMIT_REACHED":
            if (error.limit === null || error.resetAt === null) {
              reportUnexpectedError(error);
              return errorResponse(
                ANALYSIS_REQUEST_ERRORS.ANALYSIS_UNAVAILABLE,
                500,
              );
            }

            return Response.json(
              {
                error: {
                  code: "ANALYSIS_DAILY_LIMIT_REACHED",
                  message:
                    "本日の分析上限に達しました。リセット時刻以降にもう一度お試しください。",
                  action: "WAIT_FOR_RESET",
                  limit: error.limit,
                  resetAt: error.resetAt.toISOString(),
                },
              },
              {
                status: 429,
                headers: {
                  ...NO_STORE_HEADERS,
                  "Retry-After": error.resetAt.toUTCString(),
                },
              },
            );
          case "CONCURRENT_STATE_CHANGED":
            return errorResponse(
              ANALYSIS_REQUEST_ERRORS.ANALYSIS_STATE_CHANGED,
              409,
            );
        }
      }

      reportUnexpectedError(error);
      return errorResponse(ANALYSIS_REQUEST_ERRORS.ANALYSIS_UNAVAILABLE, 500);
    }
  };
}
