import { z } from "zod";

import {
  cameraAngleEnum,
  userOutcomeEnum,
  type practiceSessions,
  type videos,
} from "../schema";

export const MAX_VIDEO_FILE_SIZE = 100 * 1024 * 1024;

export const allowedVideoContentTypes = [
  "video/mp4",
  "video/quicktime",
] as const;

export type CameraAngle = (typeof cameraAngleEnum.enumValues)[number];
export type UserOutcome = (typeof userOutcomeEnum.enumValues)[number];
export type AllowedVideoContentType =
  (typeof allowedVideoContentTypes)[number];

type PracticeSessionInsert = typeof practiceSessions.$inferInsert;
type VideoInsert = typeof videos.$inferInsert;

export type PendingUploadSessionInsert = Pick<
  PracticeSessionInsert,
  | "id"
  | "userId"
  | "trickId"
  | "practicedAt"
  | "cameraAngle"
  | "userOutcome"
  | "memo"
>;

export type PendingUploadVideoInsert = Pick<
  VideoInsert,
  | "id"
  | "sessionId"
  | "s3Key"
  | "originalFilename"
  | "contentType"
  | "fileSize"
  | "status"
>;

export interface PendingUploadTransaction {
  findActiveTrick(trickId: string): Promise<{ id: string } | null>;
  insertSession(values: PendingUploadSessionInsert): Promise<void>;
  insertVideo(values: PendingUploadVideoInsert): Promise<void>;
}

export interface PendingUploadStore {
  transaction<T>(
    operation: (transaction: PendingUploadTransaction) => Promise<T>,
  ): Promise<T>;
}

export type PendingUploadCreatorDependencies = {
  resolveCurrentUser(): Promise<{ id: string } | null>;
  store: PendingUploadStore;
  createId(): string;
  now(): Date;
};

export type PendingUploadCreationErrorCode =
  | "UNAUTHENTICATED"
  | "TRICK_UNAVAILABLE";

export class PendingUploadCreationError extends Error {
  readonly code: PendingUploadCreationErrorCode;

  constructor(code: PendingUploadCreationErrorCode, message: string) {
    super(message);
    this.name = "PendingUploadCreationError";
    this.code = code;
  }
}

export function createPendingUploadInputSchema(now: Date) {
  return z.strictObject({
    trickId: z.uuid(),
    practicedAt: z.coerce.date().max(now, {
      message: "practicedAt must not be in the future.",
    }),
    cameraAngle: z.enum(cameraAngleEnum.enumValues),
    userOutcome: z.enum(userOutcomeEnum.enumValues),
    memo: z
      .string()
      .trim()
      .max(2_000)
      .optional()
      .transform((value) => value || null),
    video: z.strictObject({
      originalFilename: z.string().trim().min(1).max(255),
      contentType: z.enum(allowedVideoContentTypes),
      fileSize: z.number().int().positive().max(MAX_VIDEO_FILE_SIZE),
    }),
  });
}

export type CreatePendingUploadInput = z.input<
  ReturnType<typeof createPendingUploadInputSchema>
>;

export type CreatePendingUploadResult = {
  sessionId: string;
  videoId: string;
  s3Key: string;
  contentType: AllowedVideoContentType;
  fileSize: number;
  status: "PENDING_UPLOAD";
};

const extensionByContentType = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
} satisfies Record<AllowedVideoContentType, string>;

export function buildPendingUploadS3Key(input: {
  userId: string;
  sessionId: string;
  videoId: string;
  contentType: AllowedVideoContentType;
}) {
  const extension = extensionByContentType[input.contentType];

  return `private/${encodeURIComponent(input.userId)}/${input.sessionId}/${input.videoId}/original.${extension}`;
}

export function createPendingUploadCreator(
  dependencies: PendingUploadCreatorDependencies,
) {
  return async function createPendingUpload(input: unknown) {
    const currentUser = await dependencies.resolveCurrentUser();

    if (!currentUser) {
      throw new PendingUploadCreationError(
        "UNAUTHENTICATED",
        "An authenticated session is required.",
      );
    }

    const parsedInput = createPendingUploadInputSchema(
      dependencies.now(),
    ).parse(input);
    const sessionId = dependencies.createId();
    const videoId = dependencies.createId();
    const s3Key = buildPendingUploadS3Key({
      userId: currentUser.id,
      sessionId,
      videoId,
      contentType: parsedInput.video.contentType,
    });

    return dependencies.store.transaction(async (transaction) => {
      const trick = await transaction.findActiveTrick(parsedInput.trickId);

      if (!trick) {
        throw new PendingUploadCreationError(
          "TRICK_UNAVAILABLE",
          "The selected trick does not exist or is inactive.",
        );
      }

      await transaction.insertSession({
        id: sessionId,
        userId: currentUser.id,
        trickId: trick.id,
        practicedAt: parsedInput.practicedAt,
        cameraAngle: parsedInput.cameraAngle,
        userOutcome: parsedInput.userOutcome,
        memo: parsedInput.memo,
      });
      await transaction.insertVideo({
        id: videoId,
        sessionId,
        s3Key,
        originalFilename: parsedInput.video.originalFilename,
        contentType: parsedInput.video.contentType,
        fileSize: parsedInput.video.fileSize,
        status: "PENDING_UPLOAD",
      });

      return {
        sessionId,
        videoId,
        s3Key,
        contentType: parsedInput.video.contentType,
        fileSize: parsedInput.video.fileSize,
        status: "PENDING_UPLOAD",
      } satisfies CreatePendingUploadResult;
    });
  };
}
