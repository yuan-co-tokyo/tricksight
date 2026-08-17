import { z } from "zod";

import type { VideoAnalysisProvider } from "@/lib/analysis/provider";
import {
  analysisStatusEnum,
  type analyses,
  type videoStatusEnum,
} from "@/lib/db/schema";

type AnalysisInsert = typeof analyses.$inferInsert;
type VideoStatus = (typeof videoStatusEnum.enumValues)[number];
type AnalysisStatus = (typeof analysisStatusEnum.enumValues)[number];

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;

export const DAILY_ANALYSIS_LIMIT = 10;

export type AnalysisDailyWindow = {
  startsAt: Date;
  resetsAt: Date;
};

export function getAnalysisDailyWindow(now: Date): AnalysisDailyWindow {
  const jstTimestamp = now.getTime() + JST_OFFSET_MS;
  const jstDayStart =
    Math.floor(jstTimestamp / MILLISECONDS_PER_DAY) * MILLISECONDS_PER_DAY;
  const startsAtTimestamp = jstDayStart - JST_OFFSET_MS;

  return {
    startsAt: new Date(startsAtTimestamp),
    resetsAt: new Date(startsAtTimestamp + MILLISECONDS_PER_DAY),
  };
}

export type OwnedVideoForQueuedAnalysis = {
  id: string;
  status: VideoStatus;
  trickSlug: string;
  stance: "REGULAR" | "GOOFY" | null;
};

export type QueuedAnalysisInsert = Pick<
  AnalysisInsert,
  "id" | "videoId" | "provider" | "modelId" | "promptVersion" | "status"
>;

export type InProgressAnalysis = {
  id: string;
  videoId: string;
  provider: string;
  modelId: string;
  promptVersion: string;
  status: Extract<AnalysisStatus, "QUEUED" | "ANALYZING">;
};

export interface QueuedAnalysisTransaction {
  lockUserAnalysisQuota(userId: string): Promise<boolean>;
  findOwnedVideo(input: {
    userId: string;
    videoId: string;
  }): Promise<OwnedVideoForQueuedAnalysis | null>;
  countUserAnalysesInWindow(input: {
    userId: string;
    startsAt: Date;
    endsBefore: Date;
  }): Promise<number>;
  insertQueuedAnalysis(
    values: QueuedAnalysisInsert,
  ): Promise<InProgressAnalysis | null>;
  findInProgressAnalysis(videoId: string): Promise<InProgressAnalysis | null>;
}

export interface QueuedAnalysisStore {
  transaction<T>(
    operation: (transaction: QueuedAnalysisTransaction) => Promise<T>,
  ): Promise<T>;
}

export type QueuedAnalysisCreatorDependencies = {
  resolveCurrentUser(): Promise<{ id: string } | null>;
  store: QueuedAnalysisStore;
  createProvider(): Pick<VideoAnalysisProvider, "providerName" | "modelId">;
  resolvePromptVersion(trickSlug: string): string;
  createId(): string;
  now(): Date;
};

export type QueuedAnalysisCreationErrorCode =
  | "UNAUTHENTICATED"
  | "VIDEO_NOT_FOUND"
  | "VIDEO_NOT_READY"
  | "STANCE_REQUIRED"
  | "PROMPT_UNAVAILABLE"
  | "DAILY_LIMIT_REACHED"
  | "CONCURRENT_STATE_CHANGED";

type QueuedAnalysisCreationErrorOptions = ErrorOptions & {
  limit?: number;
  resetAt?: Date;
};

export class QueuedAnalysisCreationError extends Error {
  readonly code: QueuedAnalysisCreationErrorCode;
  readonly limit: number | null;
  readonly resetAt: Date | null;

  constructor(
    code: QueuedAnalysisCreationErrorCode,
    message: string,
    options?: QueuedAnalysisCreationErrorOptions,
  ) {
    super(message, options);
    this.name = "QueuedAnalysisCreationError";
    this.code = code;
    this.limit = options?.limit ?? null;
    this.resetAt = options?.resetAt ?? null;
  }
}

export const createQueuedAnalysisInputSchema = z.strictObject({
  videoId: z.uuid(),
});

export type CreateQueuedAnalysisInput = z.input<
  typeof createQueuedAnalysisInputSchema
>;

export type CreateQueuedAnalysisResult =
  | {
      outcome: "CREATED";
      analysis: InProgressAnalysis & { status: "QUEUED" };
    }
  | {
      outcome: "ALREADY_IN_PROGRESS";
      analysis: InProgressAnalysis;
    };

function isAnalyzableVideoStatus(
  status: VideoStatus,
): status is "UPLOADED" | "READY" {
  return status === "UPLOADED" || status === "READY";
}

export function createQueuedAnalysisCreator(
  dependencies: QueuedAnalysisCreatorDependencies,
) {
  return async function createQueuedAnalysis(
    input: unknown,
  ): Promise<CreateQueuedAnalysisResult> {
    const currentUser = await dependencies.resolveCurrentUser();

    if (!currentUser) {
      throw new QueuedAnalysisCreationError(
        "UNAUTHENTICATED",
        "An authenticated session is required.",
      );
    }

    const parsedInput = createQueuedAnalysisInputSchema.parse(input);

    return dependencies.store.transaction(async (transaction) => {
      // 同一ユーザーの上限判定とINSERTを直列化し、並列リクエストでの超過を防ぐ。
      const quotaLocked = await transaction.lockUserAnalysisQuota(
        currentUser.id,
      );

      if (!quotaLocked) {
        throw new QueuedAnalysisCreationError(
          "UNAUTHENTICATED",
          "The authenticated user no longer exists.",
        );
      }

      const video = await transaction.findOwnedVideo({
        userId: currentUser.id,
        videoId: parsedInput.videoId,
      });

      if (!video) {
        throw new QueuedAnalysisCreationError(
          "VIDEO_NOT_FOUND",
          "The selected video does not exist for the current user.",
        );
      }

      if (!isAnalyzableVideoStatus(video.status)) {
        throw new QueuedAnalysisCreationError(
          "VIDEO_NOT_READY",
          "The selected video is not ready for analysis.",
        );
      }

      if (video.stance === null) {
        throw new QueuedAnalysisCreationError(
          "STANCE_REQUIRED",
          "Set a stance in the profile before requesting analysis.",
        );
      }

      // 重複送信は新しい枠を消費せず、T6-1と同じ既存行を返す。
      const inProgress = await transaction.findInProgressAnalysis(video.id);

      if (inProgress) {
        return {
          outcome: "ALREADY_IN_PROGRESS",
          analysis: inProgress,
        };
      }

      const dailyWindow = getAnalysisDailyWindow(dependencies.now());
      const dailyAnalysisCount =
        await transaction.countUserAnalysesInWindow({
          userId: currentUser.id,
          startsAt: dailyWindow.startsAt,
          endsBefore: dailyWindow.resetsAt,
        });

      if (dailyAnalysisCount >= DAILY_ANALYSIS_LIMIT) {
        throw new QueuedAnalysisCreationError(
          "DAILY_LIMIT_REACHED",
          "The daily analysis limit has been reached.",
          {
            limit: DAILY_ANALYSIS_LIMIT,
            resetAt: dailyWindow.resetsAt,
          },
        );
      }

      let promptVersion: string;

      try {
        // キュー投入時点のトリック別プロンプトを複合versionとして固定する。
        promptVersion = dependencies.resolvePromptVersion(video.trickSlug);
      } catch (cause) {
        throw new QueuedAnalysisCreationError(
          "PROMPT_UNAVAILABLE",
          "The selected trick does not have an analysis prompt.",
          { cause },
        );
      }

      const provider = dependencies.createProvider();
      const values = {
        id: dependencies.createId(),
        videoId: video.id,
        provider: provider.providerName,
        modelId: provider.modelId,
        promptVersion,
        status: "QUEUED",
      } satisfies QueuedAnalysisInsert;

      // 競合行が直後に完了する競合も考慮し、一度だけ再INSERTを試す。
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const inserted = await transaction.insertQueuedAnalysis(values);

        if (inserted) {
          return {
            outcome: "CREATED",
            analysis: { ...inserted, status: "QUEUED" },
          };
        }

        const existing = await transaction.findInProgressAnalysis(video.id);

        if (existing) {
          return {
            outcome: "ALREADY_IN_PROGRESS",
            analysis: existing,
          };
        }
      }

      throw new QueuedAnalysisCreationError(
        "CONCURRENT_STATE_CHANGED",
        "The analysis state changed while creating a queued analysis.",
      );
    });
  };
}
