import { z } from "zod";

export const deleteSessionInputSchema = z.strictObject({
  sessionId: z.uuid(),
});

export type InProgressAnalysisStatus = "QUEUED" | "ANALYZING";

export type OwnedSessionForDeletion = {
  id: string;
  video: {
    id: string;
    s3Key: string;
  } | null;
  inProgressAnalysis: {
    id: string;
    status: InProgressAnalysisStatus;
  } | null;
};

export interface SessionDeletionTransaction {
  findOwnedSessionForDeletion(input: {
    userId: string;
    sessionId: string;
  }): Promise<OwnedSessionForDeletion | null>;
  deleteOwnedSession(input: {
    userId: string;
    sessionId: string;
  }): Promise<boolean>;
}

export interface SessionDeletionStore {
  transaction<T>(
    operation: (transaction: SessionDeletionTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface SessionDeletionObjectStore {
  deleteObject(key: string): Promise<void>;
}

export type SessionDeletionErrorCode =
  | "NOT_FOUND"
  | "ANALYSIS_IN_PROGRESS"
  | "OBJECT_DELETE_FAILED"
  | "DATABASE_DELETE_FAILED";

export class SessionDeletionError extends Error {
  readonly code: SessionDeletionErrorCode;
  readonly cause?: unknown;

  constructor(
    code: SessionDeletionErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "SessionDeletionError";
    this.code = code;
    this.cause = cause;
  }
}

export function createSessionDeletionService(dependencies: {
  store: SessionDeletionStore;
  objects: SessionDeletionObjectStore;
}) {
  return async function deleteSession(input: {
    userId: string;
    body: unknown;
  }) {
    const { sessionId } = deleteSessionInputSchema.parse(input.body);

    try {
      return await dependencies.store.transaction(async (transaction) => {
        const session = await transaction.findOwnedSessionForDeletion({
          userId: input.userId,
          sessionId,
        });

        // 不存在と所有者不一致を区別せず、他ユーザーの履歴を示唆しない。
        if (!session) {
          throw new SessionDeletionError(
            "NOT_FOUND",
            "The requested session was not found.",
          );
        }

        if (session.inProgressAnalysis) {
          throw new SessionDeletionError(
            "ANALYSIS_IN_PROGRESS",
            "A session with an in-progress analysis cannot be deleted.",
          );
        }

        if (session.video) {
          try {
            // S3を先に削除し、失敗時はtransactionをrollbackしてDBを残す。
            await dependencies.objects.deleteObject(session.video.s3Key);
          } catch (cause) {
            throw new SessionDeletionError(
              "OBJECT_DELETE_FAILED",
              "The video object could not be deleted.",
              cause,
            );
          }
        }

        const deleted = await transaction.deleteOwnedSession({
          userId: input.userId,
          sessionId,
        });

        if (!deleted) {
          throw new SessionDeletionError(
            "DATABASE_DELETE_FAILED",
            "The session could not be deleted after its object was removed.",
          );
        }

        return { sessionId } as const;
      });
    } catch (error) {
      if (error instanceof SessionDeletionError) throw error;

      throw new SessionDeletionError(
        "DATABASE_DELETE_FAILED",
        "The session deletion transaction failed.",
        error,
      );
    }
  };
}
