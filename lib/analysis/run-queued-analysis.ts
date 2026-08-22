import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  analyses,
  practiceSessions,
  tricks,
  user,
  videos,
} from "@/lib/db/schema";
import { createVideoUploadStorageConfigFromEnv } from "@/lib/uploads/presigned-post-core";
import {
  getPromptForTrick,
  isSupportedTrickSlug,
  promptVersionFamily,
} from "@/prompts/common-system-v2";

import { createVideoAnalysisProvider } from "./provider-factory";
import {
  createRunQueuedAnalysis,
  type QueuedAnalysisExecutionStore,
} from "./run-queued-analysis-core";

const queuedAnalysisExecutionStore: QueuedAnalysisExecutionStore = {
  async claimQueuedAnalysis(input) {
    const [claimed] = await db
      .update(analyses)
      .set({
        status: "ANALYZING",
        startedAt: input.startedAt,
        attemptCount: sql`${analyses.attemptCount} + 1`,
      })
      .where(
        and(
          eq(analyses.id, input.analysisId),
          eq(analyses.status, "QUEUED"),
        ),
      )
      .returning({
        id: analyses.id,
        provider: analyses.provider,
        modelId: analyses.modelId,
        promptVersion: analyses.promptVersion,
      });

    return claimed ?? null;
  },

  async loadExecutionContext(analysisId) {
    const [context] = await db
      .select({
        videoS3Key: videos.s3Key,
        videoStatus: videos.status,
        trickSlug: tricks.slug,
        stance: user.stance,
        cameraAngle: practiceSessions.cameraAngle,
      })
      .from(analyses)
      .innerJoin(videos, eq(videos.id, analyses.videoId))
      .innerJoin(
        practiceSessions,
        eq(practiceSessions.id, videos.sessionId),
      )
      .innerJoin(tricks, eq(tricks.id, practiceSessions.trickId))
      .innerJoin(user, eq(user.id, practiceSessions.userId))
      .where(
        and(
          eq(analyses.id, analysisId),
          eq(analyses.status, "ANALYZING"),
        ),
      )
      .limit(1);

    return context ?? null;
  },

  async completeAnalysis(input) {
    const [completed] = await db
      .update(analyses)
      .set({
        status: "COMPLETED",
        resultJson: input.resultJson,
        rawResponse: input.rawResponse,
        promptVersion: input.promptVersion,
        errorCode: null,
        errorMessage: null,
        completedAt: input.completedAt,
      })
      .where(
        and(
          eq(analyses.id, input.analysisId),
          eq(analyses.status, "ANALYZING"),
        ),
      )
      .returning({ id: analyses.id });

    return Boolean(completed);
  },

  async failAnalysis(input) {
    const [failed] = await db
      .update(analyses)
      .set({
        status: "FAILED",
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        completedAt: input.completedAt,
      })
      .where(
        and(
          eq(analyses.id, input.analysisId),
          eq(analyses.status, "ANALYZING"),
        ),
      )
      .returning({ id: analyses.id });

    return Boolean(failed);
  },
};

export const runQueuedAnalysis = createRunQueuedAnalysis({
  store: queuedAnalysisExecutionStore,
  createProvider: createVideoAnalysisProvider,
  resolvePrompt(trickSlug) {
    if (!isSupportedTrickSlug(trickSlug)) {
      throw new Error(`Unsupported trick slug: ${trickSlug}`);
    }

    return {
      trick: trickSlug,
      family: promptVersionFamily,
      version: getPromptForTrick(trickSlug).version,
    };
  },
  createVideoS3Uri(s3Key) {
    const { bucket } = createVideoUploadStorageConfigFromEnv();
    return `s3://${bucket}/${s3Key}`;
  },
  now: () => new Date(),
});
