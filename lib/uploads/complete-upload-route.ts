import { z } from "zod";

import { UploadCompletionError } from "./complete-upload-core";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

type CompleteUploadResult = {
  status: "UPLOADED" | "READY";
  idempotent: boolean;
};

type Dependencies = {
  resolveCurrentUser(): Promise<{ id: string } | null>;
  completeUpload(input: {
    userId: string;
    body: unknown;
  }): Promise<CompleteUploadResult>;
  reportUnexpectedError?(error: unknown): void;
};

function errorResponse(code: string, status: number) {
  return Response.json(
    { error: { code } },
    { status, headers: NO_STORE_HEADERS },
  );
}

export function createCompleteUploadRouteHandler(
  dependencies: Dependencies,
) {
  const reportUnexpectedError =
    dependencies.reportUnexpectedError ??
    ((error: unknown) => {
      console.error("Failed to complete video upload.", error);
    });

  return async function POST(request: Request) {
    let currentUser: { id: string } | null;

    try {
      currentUser = await dependencies.resolveCurrentUser();
    } catch (error) {
      reportUnexpectedError(error);
      return errorResponse("UPLOAD_COMPLETION_FAILED", 500);
    }

    if (!currentUser) {
      return errorResponse("UNAUTHENTICATED", 401);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return errorResponse("INVALID_REQUEST", 400);
    }

    try {
      const result = await dependencies.completeUpload({
        userId: currentUser.id,
        body,
      });

      return Response.json(result, {
        status: 200,
        headers: NO_STORE_HEADERS,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return errorResponse("INVALID_REQUEST", 400);
      }

      if (error instanceof UploadCompletionError) {
        if (error.code === "NOT_FOUND") {
          return errorResponse("UPLOAD_NOT_FOUND", 404);
        }

        if (error.code === "NOT_COMPLETABLE") {
          return errorResponse("UPLOAD_NOT_COMPLETABLE", 409);
        }

        if (error.code === "VERIFICATION_FAILED") {
          return errorResponse("UPLOAD_VERIFICATION_FAILED", 422);
        }

        reportUnexpectedError(error.cause ?? error);
        return errorResponse("UPLOAD_COMPLETION_FAILED", 500);
      }

      reportUnexpectedError(error);
      return errorResponse("UPLOAD_COMPLETION_FAILED", 500);
    }
  };
}
