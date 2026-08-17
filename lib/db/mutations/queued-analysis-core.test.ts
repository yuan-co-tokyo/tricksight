import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import {
  QueuedAnalysisCreationError,
  createQueuedAnalysisCreator,
  type InProgressAnalysis,
  type OwnedVideoForQueuedAnalysis,
  type QueuedAnalysisInsert,
  type QueuedAnalysisStore,
} from "./queued-analysis-core";

const ids = {
  video: "00000000-0000-4000-8000-000000000001",
  analysis: "00000000-0000-4000-8000-000000000002",
  existingAnalysis: "00000000-0000-4000-8000-000000000003",
} as const;

const ownedVideo = {
  id: ids.video,
  status: "UPLOADED",
  trickSlug: "kickflip",
} satisfies OwnedVideoForQueuedAnalysis;

const insertedAnalysis = {
  id: ids.analysis,
  videoId: ids.video,
  provider: "provider-from-instance",
  modelId: "model-from-instance",
  promptVersion: "common-system-v1+kickflip-v1",
  status: "QUEUED",
} satisfies InProgressAnalysis;

function createMockStore(options: {
  ownedVideo?: OwnedVideoForQueuedAnalysis | null;
  insertResults?: Array<InProgressAnalysis | null>;
  existingAnalysis?: InProgressAnalysis | null;
} = {}) {
  const events: string[] = [];
  const insertedValues: QueuedAnalysisInsert[] = [];
  const selectedVideo =
    options.ownedVideo === undefined ? ownedVideo : options.ownedVideo;
  const insertResults = options.insertResults ?? [insertedAnalysis];
  let insertAttempt = 0;

  const transaction = {
    findOwnedVideo: vi.fn(async () => {
      events.push("video:find-owned");
      return selectedVideo;
    }),
    insertQueuedAnalysis: vi.fn(async (values: QueuedAnalysisInsert) => {
      events.push("analysis:insert");
      insertedValues.push(values);
      const result = insertResults[insertAttempt] ?? null;
      insertAttempt += 1;
      return result;
    }),
    findInProgressAnalysis: vi.fn(async () => {
      events.push("analysis:find-in-progress");
      return options.existingAnalysis ?? null;
    }),
  };

  const store: QueuedAnalysisStore = {
    async transaction(operation) {
      events.push("transaction:start");
      try {
        const result = await operation(transaction);
        events.push("transaction:commit");
        return result;
      } catch (error) {
        events.push("transaction:rollback");
        throw error;
      }
    },
  };

  return { events, insertedValues, store, transaction };
}

function setup(options: Parameters<typeof createMockStore>[0] = {}) {
  const mockStore = createMockStore(options);
  const resolveCurrentUser = vi
    .fn()
    .mockResolvedValue({ id: "user-from-session" });
  const createProvider = vi.fn(() => ({
    providerName: "provider-from-instance",
    modelId: "model-from-instance",
  }));
  const resolvePromptVersion = vi.fn(
    () => "common-system-v1+kickflip-v1",
  );
  const creator = createQueuedAnalysisCreator({
    resolveCurrentUser,
    store: mockStore.store,
    createProvider,
    resolvePromptVersion,
    createId: () => ids.analysis,
  });

  return {
    creator,
    createProvider,
    resolveCurrentUser,
    resolvePromptVersion,
    ...mockStore,
  };
}

describe("createQueuedAnalysisCreator", () => {
  it.each(["UPLOADED", "READY"] as const)(
    "creates a QUEUED analysis for an owned %s video",
    async (status) => {
      const { creator, insertedValues, resolvePromptVersion, transaction } =
        setup({ ownedVideo: { ...ownedVideo, status } });

      await expect(creator({ videoId: ids.video })).resolves.toEqual({
        outcome: "CREATED",
        analysis: insertedAnalysis,
      });
      expect(transaction.findOwnedVideo).toHaveBeenCalledWith({
        userId: "user-from-session",
        videoId: ids.video,
      });
      expect(resolvePromptVersion).toHaveBeenCalledWith("kickflip");
      expect(insertedValues).toEqual([
        {
          id: ids.analysis,
          videoId: ids.video,
          provider: "provider-from-instance",
          modelId: "model-from-instance",
          promptVersion: "common-system-v1+kickflip-v1",
          status: "QUEUED",
        },
      ]);
    },
  );

  it("does not create an analysis for another user's video", async () => {
    const { creator, createProvider, events, resolvePromptVersion } = setup({
      ownedVideo: null,
    });

    await expect(creator({ videoId: ids.video })).rejects.toMatchObject({
      code: "VIDEO_NOT_FOUND",
    } satisfies Partial<QueuedAnalysisCreationError>);
    expect(createProvider).not.toHaveBeenCalled();
    expect(resolvePromptVersion).not.toHaveBeenCalled();
    expect(events).toEqual([
      "transaction:start",
      "video:find-owned",
      "transaction:rollback",
    ]);
  });

  it.each(["PENDING_UPLOAD", "FAILED"] as const)(
    "does not create an analysis for a %s video",
    async (status) => {
      const { creator, createProvider, insertedValues } = setup({
        ownedVideo: { ...ownedVideo, status },
      });

      await expect(creator({ videoId: ids.video })).rejects.toMatchObject({
        code: "VIDEO_NOT_READY",
      } satisfies Partial<QueuedAnalysisCreationError>);
      expect(createProvider).not.toHaveBeenCalled();
      expect(insertedValues).toEqual([]);
    },
  );

  it("returns the existing analysis when one is already in progress", async () => {
    const existingAnalysis = {
      ...insertedAnalysis,
      id: ids.existingAnalysis,
      status: "ANALYZING",
    } satisfies InProgressAnalysis;
    const { creator, events } = setup({
      insertResults: [null],
      existingAnalysis,
    });

    await expect(creator({ videoId: ids.video })).resolves.toEqual({
      outcome: "ALREADY_IN_PROGRESS",
      analysis: existingAnalysis,
    });
    expect(events).toEqual([
      "transaction:start",
      "video:find-owned",
      "analysis:insert",
      "analysis:find-in-progress",
      "transaction:commit",
    ]);
  });

  it("retries once if the conflicting analysis completes before it can be read", async () => {
    const { creator, transaction } = setup({
      insertResults: [null, insertedAnalysis],
      existingAnalysis: null,
    });

    await expect(creator({ videoId: ids.video })).resolves.toEqual({
      outcome: "CREATED",
      analysis: insertedAnalysis,
    });
    expect(transaction.insertQueuedAnalysis).toHaveBeenCalledTimes(2);
    expect(transaction.findInProgressAnalysis).toHaveBeenCalledOnce();
  });

  it("rejects input that attempts to supply userId", async () => {
    const { creator, insertedValues } = setup();

    await expect(
      creator({ videoId: ids.video, userId: "attacker-selected-user" }),
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(insertedValues).toEqual([]);
  });

  it("rejects creation when no authenticated session exists", async () => {
    const mockStore = createMockStore();
    const creator = createQueuedAnalysisCreator({
      resolveCurrentUser: vi.fn().mockResolvedValue(null),
      store: mockStore.store,
      createProvider: vi.fn(),
      resolvePromptVersion: vi.fn(),
      createId: vi.fn(),
    });

    await expect(creator({ videoId: ids.video })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    } satisfies Partial<QueuedAnalysisCreationError>);
    expect(mockStore.events).toEqual([]);
  });

  it("reports an unavailable prompt before inserting", async () => {
    const { creator, insertedValues, resolvePromptVersion } = setup();
    resolvePromptVersion.mockImplementation(() => {
      throw new Error("unsupported trick");
    });

    await expect(creator({ videoId: ids.video })).rejects.toMatchObject({
      code: "PROMPT_UNAVAILABLE",
    } satisfies Partial<QueuedAnalysisCreationError>);
    expect(insertedValues).toEqual([]);
  });
});
