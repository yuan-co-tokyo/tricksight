import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_VIDEO_FILE_SIZE,
  PendingUploadCreationError,
  createPendingUploadCreator,
  type PendingUploadSessionInsert,
  type PendingUploadStore,
  type PendingUploadVideoInsert,
} from "./pending-upload-core";

const ids = {
  trick: "00000000-0000-4000-8000-000000000001",
  session: "00000000-0000-4000-8000-000000000002",
  video: "00000000-0000-4000-8000-000000000003",
} as const;

const now = new Date("2026-08-16T00:00:00.000Z");

const validInput = {
  trickId: ids.trick,
  practicedAt: "2026-08-15T12:00:00.000Z",
  cameraAngle: "SIDE",
  userOutcome: "LANDED",
  memo: "着地を安定させる練習",
  video: {
    originalFilename: "my-private-practice-name.mp4",
    contentType: "video/mp4",
    fileSize: 12_345_678,
  },
} as const;

function createMockStore(options: {
  activeTrick?: { id: string } | null;
  failVideoInsert?: boolean;
} = {}) {
  const events: string[] = [];
  const committedSessions: PendingUploadSessionInsert[] = [];
  const committedVideos: PendingUploadVideoInsert[] = [];
  const activeTrick =
    options.activeTrick === undefined ? { id: ids.trick } : options.activeTrick;

  const store: PendingUploadStore = {
    async transaction(operation) {
      const stagedSessions: PendingUploadSessionInsert[] = [];
      const stagedVideos: PendingUploadVideoInsert[] = [];
      events.push("transaction:start");

      try {
        const result = await operation({
          async findActiveTrick() {
            events.push("trick:find-active");
            return activeTrick;
          },
          async insertSession(values) {
            events.push("session:insert");
            stagedSessions.push(values);
          },
          async insertVideo(values) {
            events.push("video:insert");
            if (options.failVideoInsert) {
              throw new Error("video insert failed");
            }
            stagedVideos.push(values);
          },
        });

        committedSessions.push(...stagedSessions);
        committedVideos.push(...stagedVideos);
        events.push("transaction:commit");
        return result;
      } catch (error) {
        events.push("transaction:rollback");
        throw error;
      }
    },
  };

  return { store, events, committedSessions, committedVideos };
}

function setup(options: Parameters<typeof createMockStore>[0] = {}) {
  const mockStore = createMockStore(options);
  const generatedIds = [ids.session, ids.video];
  const resolveCurrentUser = vi.fn().mockResolvedValue({ id: "user-from-session" });
  const creator = createPendingUploadCreator({
    resolveCurrentUser,
    store: mockStore.store,
    createId: () => generatedIds.shift() ?? "unexpected-id",
    now: () => now,
  });

  return { creator, resolveCurrentUser, ...mockStore };
}

describe("createPendingUploadCreator", () => {
  it("rejects a content type other than MP4 or QuickTime", async () => {
    const { creator, events } = setup();

    await expect(
      creator({
        ...validInput,
        video: { ...validInput.video, contentType: "video/webm" },
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(events).toEqual([]);
  });

  it("rejects a file larger than 100 MiB", async () => {
    const { creator, events } = setup();

    await expect(
      creator({
        ...validInput,
        video: {
          ...validInput.video,
          fileSize: MAX_VIDEO_FILE_SIZE + 1,
        },
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(events).toEqual([]);
  });

  it("rejects a future practice date", async () => {
    const { creator, events } = setup();

    await expect(
      creator({ ...validInput, practicedAt: "2026-08-16T00:00:00.001Z" }),
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(events).toEqual([]);
  });

  it("builds an MP4 key from server-owned IDs without using the original filename", async () => {
    const { creator, committedSessions, committedVideos, events } = setup();

    const result = await creator(validInput);

    expect(result).toEqual({
      sessionId: ids.session,
      videoId: ids.video,
      s3Key: `private/user-from-session/${ids.session}/${ids.video}/original.mp4`,
      contentType: "video/mp4",
      fileSize: validInput.video.fileSize,
      status: "PENDING_UPLOAD",
    });
    expect(result.s3Key).not.toContain(validInput.video.originalFilename);
    expect(committedSessions).toEqual([
      expect.objectContaining({
        id: ids.session,
        userId: "user-from-session",
        trickId: ids.trick,
      }),
    ]);
    expect(committedVideos).toEqual([
      expect.objectContaining({
        id: ids.video,
        sessionId: ids.session,
        originalFilename: validInput.video.originalFilename,
        status: "PENDING_UPLOAD",
      }),
    ]);
    expect(events).toEqual([
      "transaction:start",
      "trick:find-active",
      "session:insert",
      "video:insert",
      "transaction:commit",
    ]);
  });

  it("derives the MOV extension from video/quicktime", async () => {
    const { creator } = setup();

    const result = await creator({
      ...validInput,
      video: {
        ...validInput.video,
        originalFilename: "untrusted-name.mp4",
        contentType: "video/quicktime",
      },
    });

    expect(result.s3Key).toBe(
      `private/user-from-session/${ids.session}/${ids.video}/original.mov`,
    );
    expect(result.s3Key).not.toContain("untrusted-name.mp4");
  });

  it.each(["missing", "inactive"])(
    "rejects a %s trick before inserting either record",
    async () => {
      const { creator, committedSessions, committedVideos, events } = setup({
        activeTrick: null,
      });

      await expect(creator(validInput)).rejects.toMatchObject({
        code: "TRICK_UNAVAILABLE",
      } satisfies Partial<PendingUploadCreationError>);
      expect(committedSessions).toEqual([]);
      expect(committedVideos).toEqual([]);
      expect(events).toEqual([
        "transaction:start",
        "trick:find-active",
        "transaction:rollback",
      ]);
    },
  );

  it("rolls back the session if inserting its video fails", async () => {
    const { creator, committedSessions, committedVideos, events } = setup({
      failVideoInsert: true,
    });

    await expect(creator(validInput)).rejects.toThrow("video insert failed");
    expect(committedSessions).toEqual([]);
    expect(committedVideos).toEqual([]);
    expect(events.at(-1)).toBe("transaction:rollback");
  });

  it("does not accept userId from client input", async () => {
    const { creator, committedSessions } = setup();

    await expect(
      creator({ ...validInput, userId: "attacker-selected-user" }),
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(committedSessions).toEqual([]);
  });

  it("rejects the mutation when no authenticated session exists", async () => {
    const mockStore = createMockStore();
    const creator = createPendingUploadCreator({
      resolveCurrentUser: vi.fn().mockResolvedValue(null),
      store: mockStore.store,
      createId: vi.fn(),
      now: () => now,
    });

    await expect(creator(validInput)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    } satisfies Partial<PendingUploadCreationError>);
    expect(mockStore.events).toEqual([]);
  });
});
