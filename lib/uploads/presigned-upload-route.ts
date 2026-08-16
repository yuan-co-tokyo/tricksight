import { z } from "zod";

import {
  PendingUploadCreationError,
  type CreatePendingUploadResult,
} from "../db/mutations/pending-upload-core";

import type { VideoPresignedPostInput } from "./presigned-post-core";

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
  createVideoPresignedPost(
    input: VideoPresignedPostInput,
  ): Promise<PresignedPostResult>;
  reportUnexpectedError?(error: unknown): void;
};

function errorResponse(code: string, status: number) {
  return Response.json(
    { error: { code } },
    { status, headers: NO_STORE_HEADERS },
  );
}

export function createPresignedUploadRouteHandler(
  dependencies: Dependencies,
) {
  const reportUnexpectedError =
    dependencies.reportUnexpectedError ??
    ((error: unknown) => {
      console.error("Failed to initialize video upload.", error);
    });

  return async function POST(request: Request) {
    try {
      const currentUser = await dependencies.resolveCurrentUser();

      if (!currentUser) {
        return errorResponse("UNAUTHENTICATED", 401);
      }
    } catch (error) {
      reportUnexpectedError(error);
      return errorResponse("UPLOAD_INITIALIZATION_FAILED", 500);
    }

    let input: unknown;

    try {
      input = await request.json();
    } catch {
      return errorResponse("INVALID_REQUEST", 400);
    }

    try {
      const pendingUpload = await dependencies.createPendingUpload(input);
      const presignedPost = await dependencies.createVideoPresignedPost({
        s3Key: pendingUpload.s3Key,
        contentType: pendingUpload.contentType,
      });

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

      reportUnexpectedError(error);
      return errorResponse("UPLOAD_INITIALIZATION_FAILED", 500);
    }
  };
}
