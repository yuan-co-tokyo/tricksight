import { z } from "zod";

import type { AnalysisStatusResult } from "./analysis-status-core";
import {
  ANALYSIS_REQUEST_ERRORS,
  type PublicAnalysisError,
} from "./analysis-public-error";
import { createUnexpectedErrorReporter } from "../observability/application-log";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

type Dependencies = {
  resolveCurrentUser(): Promise<{ id: string } | null>;
  getOwnedAnalysisStatus(input: {
    userId: string;
    analysisId: string;
  }): Promise<AnalysisStatusResult | null>;
  reportUnexpectedError?(error: unknown): void;
};

type AnalysisStatusRouteContext = {
  params: Promise<{ analysisId: string }>;
};

function errorResponse(error: PublicAnalysisError, status: number) {
  return Response.json(
    { error },
    { status, headers: NO_STORE_HEADERS },
  );
}

export function createAnalysisStatusRouteHandler(
  dependencies: Dependencies,
) {
  const reportUnexpectedError = createUnexpectedErrorReporter({
    event: "analysis.status.failed",
    reporter: dependencies.reportUnexpectedError,
  });

  return async function GET(
    _request: Request,
    context: AnalysisStatusRouteContext,
  ) {
    let currentUser: { id: string } | null;

    try {
      currentUser = await dependencies.resolveCurrentUser();
    } catch (error) {
      reportUnexpectedError(error, { stage: "resolve_current_user" });
      return errorResponse(ANALYSIS_REQUEST_ERRORS.ANALYSIS_UNAVAILABLE, 500);
    }

    if (!currentUser) {
      return errorResponse(ANALYSIS_REQUEST_ERRORS.UNAUTHENTICATED, 401);
    }

    const { analysisId } = await context.params;
    if (!z.uuid().safeParse(analysisId).success) {
      return errorResponse(ANALYSIS_REQUEST_ERRORS.ANALYSIS_NOT_FOUND, 404);
    }

    try {
      const analysis = await dependencies.getOwnedAnalysisStatus({
        userId: currentUser.id,
        analysisId,
      });

      if (!analysis) {
        return errorResponse(ANALYSIS_REQUEST_ERRORS.ANALYSIS_NOT_FOUND, 404);
      }

      return Response.json(
        {
          analysisId: analysis.analysisId,
          status: analysis.status,
          error: analysis.error,
        },
        {
          status: 200,
          headers: NO_STORE_HEADERS,
        },
      );
    } catch (error) {
      reportUnexpectedError(error, {
        stage: "read_status",
        analysisId,
      });
      return errorResponse(ANALYSIS_REQUEST_ERRORS.ANALYSIS_UNAVAILABLE, 500);
    }
  };
}
