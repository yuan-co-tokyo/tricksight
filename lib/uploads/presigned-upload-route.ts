import { z } from "zod";

import {
  PendingUploadCreationError,
  type CreatePendingUploadResult,
} from "../db/mutations/pending-upload-core";

import type { VideoPresignedPostInput } from "./presigned-post-core";
import { createUnexpectedErrorReporter } from "../observability/application-log";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

type PresignedPostResult = {
  url: string;
  fields: Record<string, string>;
};

type Dependencies = {
  resolveCurrentUser(): Promise<{ id: string } | null>;
  createPendingUpload(input: unknown): Promise<CreatePendingUploadResult>;
  deletePendingUpload(input: {
    userId: string;
    sessionId: string;
    videoId: string;
  }): Promise<boolean>;
  createVideoPresignedPost(
    input: VideoPresignedPostInput,
  ): Promise<PresignedPostResult>;
  reportUnexpectedError?(error: unknown): void;
};

export class PendingUploadCleanupError extends Error {
  readonly code = "PENDING_UPLOAD_CLEANUP_FAILED";
  readonly cleanupError: unknown;

  constructor(signingError: unknown, cleanupError: unknown) {
    super("Failed to remove pending upload after presigning failed.", {
      cause: signingError,
    });
    this.name = "PendingUploadCleanupError";
    this.cleanupError = cleanupError;
  }
}

function errorResponse(code: string, status: number) {
  return Response.json(
    { error: { code } },
    { status, headers: NO_STORE_HEADERS },
  );
}

export function createPresignedUploadRouteHandler(
  dependencies: Dependencies,
) {
  const reportUnexpectedError = createUnexpectedErrorReporter({
    event: "upload.presigned_post.failed",
    reporter: dependencies.reportUnexpectedError,
  });

  return async function POST(request: Request) {
    let currentUser: { id: string } | null;

    try {
      currentUser = await dependencies.resolveCurrentUser();
    } catch (error) {
      reportUnexpectedError(error, { stage: "resolve_current_user" });
      return errorResponse("UPLOAD_INITIALIZATION_FAILED", 500);
    }

    if (!currentUser) {
      return errorResponse("UNAUTHENTICATED", 401);
    }

    let input: unknown;

    try {
      input = await request.json();
    } catch {
      return errorResponse("INVALID_REQUEST", 400);
    }

    try {
      const pendingUpload = await dependencies.createPendingUpload(input);
      let presignedPost: PresignedPostResult;

      try {
        presignedPost = await dependencies.createVideoPresignedPost({
          s3Key: pendingUpload.s3Key,
          contentType: pendingUpload.contentType,
        });
      } catch (signingError) {
        try {
          const deleted = await dependencies.deletePendingUpload({
            userId: currentUser.id,
            sessionId: pendingUpload.sessionId,
            videoId: pendingUpload.videoId,
          });

          if (!deleted) {
            throw new Error("No matching pending upload was deleted.");
          }
        } catch (cleanupError) {
          reportUnexpectedError(
            new PendingUploadCleanupError(signingError, cleanupError),
            {
              stage: "compensating_delete",
              sessionId: pendingUpload.sessionId,
              videoId: pendingUpload.videoId,
            },
          );
          return errorResponse("UPLOAD_INITIALIZATION_FAILED", 500);
        }

        reportUnexpectedError(signingError, {
          stage: "sign_post",
          sessionId: pendingUpload.sessionId,
          videoId: pendingUpload.videoId,
        });
        return errorResponse("UPLOAD_INITIALIZATION_FAILED", 500);
      }

      return Response.json(
        {
          url: presignedPost.url,
          fields: presignedPost.fields,
          sessionId: pendingUpload.sessionId,
          videoId: pendingUpload.videoId,
        },
        { status: 201, headers: NO_STORE_HEADERS },
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        return errorResponse("INVALID_REQUEST", 400);
      }

      if (error instanceof PendingUploadCreationError) {
        if (error.code === "UNAUTHENTICATED") {
          return errorResponse("UNAUTHENTICATED", 401);
        }

        return errorResponse("TRICK_UNAVAILABLE", 400);
      }

      reportUnexpectedError(error, { stage: "initialize_upload" });
      return errorResponse("UPLOAD_INITIALIZATION_FAILED", 500);
    }
  };
}
