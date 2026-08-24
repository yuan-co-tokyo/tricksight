import { z } from "zod";

import { SessionDeletionError } from "./session-deletion-core";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

type Dependencies = {
  resolveCurrentUser(): Promise<{ id: string } | null>;
  deleteSession(input: {
    userId: string;
    body: unknown;
  }): Promise<{ sessionId: string }>;
  reportUnexpectedError?(error: unknown): void;
};

function errorResponse(code: string, status: number) {
  return Response.json(
    { error: { code } },
    { status, headers: NO_STORE_HEADERS },
  );
}

export function createSessionDeletionRouteHandler(
  dependencies: Dependencies,
) {
  const reportUnexpectedError =
    dependencies.reportUnexpectedError ??
    ((error: unknown) => {
      console.error("Failed to delete a practice session.", error);
    });

  return async function DELETE(
    _request: Request,
    context: { params: Promise<{ sessionId: string }> },
  ) {
    let currentUser: { id: string } | null;

    try {
      currentUser = await dependencies.resolveCurrentUser();
    } catch (error) {
      reportUnexpectedError(error);
      return errorResponse("SESSION_DELETE_FAILED", 500);
    }

    if (!currentUser) {
      return errorResponse("UNAUTHENTICATED", 401);
    }

    const { sessionId } = await context.params;

    try {
      const result = await dependencies.deleteSession({
        userId: currentUser.id,
        body: { sessionId },
      });

      return Response.json(result, {
        status: 200,
        headers: NO_STORE_HEADERS,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return errorResponse("INVALID_REQUEST", 400);
      }

      if (error instanceof SessionDeletionError) {
        if (error.code === "NOT_FOUND") {
          return errorResponse("SESSION_NOT_FOUND", 404);
        }

        if (error.code === "ANALYSIS_IN_PROGRESS") {
          return errorResponse("ANALYSIS_IN_PROGRESS", 409);
        }

        reportUnexpectedError(error.cause ?? error);
        return errorResponse("SESSION_DELETE_FAILED", 500);
      }

      reportUnexpectedError(error);
      return errorResponse("SESSION_DELETE_FAILED", 500);
    }
  };
}
