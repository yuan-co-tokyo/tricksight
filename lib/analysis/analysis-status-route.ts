import { z } from "zod";

import type { AnalysisStatusResult } from "./analysis-status-core";

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

function errorResponse(code: string, status: number) {
  return Response.json(
    { error: { code } },
    { status, headers: NO_STORE_HEADERS },
  );
}

export function createAnalysisStatusRouteHandler(
  dependencies: Dependencies,
) {
  const reportUnexpectedError =
    dependencies.reportUnexpectedError ??
    ((error: unknown) => {
      console.error("Failed to read analysis status.", error);
    });

  return async function GET(
    _request: Request,
    context: AnalysisStatusRouteContext,
  ) {
    let currentUser: { id: string } | null;

    try {
      currentUser = await dependencies.resolveCurrentUser();
    } catch (error) {
      reportUnexpectedError(error);
      return errorResponse("ANALYSIS_STATUS_FAILED", 500);
    }

    if (!currentUser) return errorResponse("UNAUTHENTICATED", 401);

    const { analysisId } = await context.params;
    if (!z.uuid().safeParse(analysisId).success) {
      return errorResponse("ANALYSIS_NOT_FOUND", 404);
    }

    try {
      const analysis = await dependencies.getOwnedAnalysisStatus({
        userId: currentUser.id,
        analysisId,
      });

      if (!analysis) return errorResponse("ANALYSIS_NOT_FOUND", 404);

      return Response.json(
        {
          analysisId: analysis.analysisId,
          status: analysis.status,
          errorCode: analysis.errorCode,
        },
        {
          status: 200,
          headers: NO_STORE_HEADERS,
        },
      );
    } catch (error) {
      reportUnexpectedError(error);
      return errorResponse("ANALYSIS_STATUS_FAILED", 500);
    }
  };
}
