import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSessionDeletionService,
  SessionDeletionError,
  type OwnedSessionForDeletion,
  type SessionDeletionObjectStore,
  type SessionDeletionStore,
  type SessionDeletionTransaction,
} from "./session-deletion-core";

const sessionId = "00000000-0000-4000-8000-000000000001";
const videoId = "00000000-0000-4000-8000-000000000002";
const analysisId = "00000000-0000-4000-8000-000000000003";
const userId = "owner-user";

const ownedSession: OwnedSessionForDeletion = {
  id: sessionId,
  video: {
    id: videoId,
    s3Key: `private/${userId}/${sessionId}/${videoId}/original.mp4`,
  },
  inProgressAnalysis: null,
};

function setup() {
  const transaction: SessionDeletionTransaction = {
    findOwnedSessionForDeletion: vi.fn().mockResolvedValue(ownedSession),
    deleteOwnedSession: vi.fn().mockResolvedValue(true),
  };
  const store: SessionDeletionStore = {
    transaction: vi.fn(async (operation) => operation(transaction)),
  };
  const objects: SessionDeletionObjectStore = {
    deleteObject: vi.fn().mockResolvedValue(undefined),
  };
  const deleteSession = createSessionDeletionService({ store, objects });

  return { deleteSession, objects, store, transaction };
}

describe("session deletion service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns NOT_FOUND without touching S3 for another user's session", async () => {
    const { deleteSession, objects, transaction } = setup();
    vi.mocked(transaction.findOwnedSessionForDeletion).mockResolvedValue(null);

    await expect(
      deleteSession({ userId: "attacker", body: { sessionId } }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    } satisfies Partial<SessionDeletionError>);
    expect(transaction.findOwnedSessionForDeletion).toHaveBeenCalledWith({
      userId: "attacker",
      sessionId,
    });
    expect(objects.deleteObject).not.toHaveBeenCalled();
    expect(transaction.deleteOwnedSession).not.toHaveBeenCalled();
  });

  it.each(["QUEUED", "ANALYZING"] as const)(
    "rejects deletion while an analysis is %s",
    async (status) => {
      const { deleteSession, objects, transaction } = setup();
      vi.mocked(transaction.findOwnedSessionForDeletion).mockResolvedValue({
        ...ownedSession,
        inProgressAnalysis: { id: analysisId, status },
      });

      await expect(
        deleteSession({ userId, body: { sessionId } }),
      ).rejects.toMatchObject({
        code: "ANALYSIS_IN_PROGRESS",
      } satisfies Partial<SessionDeletionError>);
      expect(objects.deleteObject).not.toHaveBeenCalled();
      expect(transaction.deleteOwnedSession).not.toHaveBeenCalled();
    },
  );

  it("keeps the database row when S3 deletion fails", async () => {
    const { deleteSession, objects, transaction } = setup();
    vi.mocked(objects.deleteObject).mockRejectedValue(
      new Error("AccessDenied: private AWS details"),
    );

    await expect(
      deleteSession({ userId, body: { sessionId } }),
    ).rejects.toMatchObject({
      code: "OBJECT_DELETE_FAILED",
    } satisfies Partial<SessionDeletionError>);
    expect(transaction.deleteOwnedSession).not.toHaveBeenCalled();
  });

  it("deletes S3 before the owner-scoped database row", async () => {
    const { deleteSession, objects, transaction } = setup();

    await expect(
      deleteSession({ userId, body: { sessionId } }),
    ).resolves.toEqual({ sessionId });
    expect(objects.deleteObject).toHaveBeenCalledWith(ownedSession.video?.s3Key);
    expect(transaction.deleteOwnedSession).toHaveBeenCalledWith({
      userId,
      sessionId,
    });
    expect(
      vi.mocked(objects.deleteObject).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(transaction.deleteOwnedSession).mock.invocationCallOrder[0],
    );
  });

  it("leaves a retryable database row when the final delete loses", async () => {
    const { deleteSession, objects, transaction } = setup();
    vi.mocked(transaction.deleteOwnedSession).mockResolvedValue(false);

    await expect(
      deleteSession({ userId, body: { sessionId } }),
    ).rejects.toMatchObject({
      code: "DATABASE_DELETE_FAILED",
    } satisfies Partial<SessionDeletionError>);
    expect(objects.deleteObject).toHaveBeenCalledOnce();
  });

  it("deletes a session without an attached video without calling S3", async () => {
    const { deleteSession, objects, transaction } = setup();
    vi.mocked(transaction.findOwnedSessionForDeletion).mockResolvedValue({
      ...ownedSession,
      video: null,
    });

    await expect(
      deleteSession({ userId, body: { sessionId } }),
    ).resolves.toEqual({ sessionId });
    expect(objects.deleteObject).not.toHaveBeenCalled();
    expect(transaction.deleteOwnedSession).toHaveBeenCalledOnce();
  });
});
