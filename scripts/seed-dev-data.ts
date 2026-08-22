import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";

import {
  skateAnalysisResultSchema,
  type SkateAnalysisResult,
} from "@/lib/analysis/schema";
import { db, pool } from "@/lib/db";
import {
  analyses,
  practiceSessions,
  tricks,
  user,
  videos,
} from "@/lib/db/schema";

const FIXTURE_MARKER = "[tricksight-dev-fixture:v1]";
const CONFIRMATION_FLAG = "--confirm-dev-data";

type Action = "insert" | "delete";
type SupportedTrickSlug = "ollie" | "pop-shove-it" | "kickflip";

type FixtureDefinition = {
  slug: SupportedTrickSlug;
  daysAgo: number;
  cameraAngle: "SIDE" | "FRONT" | "REAR" | "DIAGONAL";
  userOutcome: "LANDED" | "BAILED" | "UNCLEAR";
  analysisStatus: "COMPLETED" | "ANALYZING" | "FAILED";
  analysisResult?: SkateAnalysisResult;
};

const completedOllieResult = {
  summary: "安定した構えからテールを弾き、ボードと一緒に着地できています。",
  detected: {
    trickMatchesSelection: true,
    visibility: "POOR",
  },
  result: {
    outcome: "LANDED",
    confidence: 0.93,
  },
  scores: {
    setup: 84,
    pop: 78,
    bodyBalance: 81,
    footControl: 76,
    landing: 86,
  },
  strengths: [
    {
      title: "着地時の姿勢",
      description: "肩の向きが安定し、両足でボードを捉えています。",
    },
  ],
  improvements: [
    {
      title: "前足を引き上げるタイミング",
      description: "テールを弾いた直後に前足をもう少し素早く引き上げましょう。",
      priority: 1,
      timestampSeconds: 1.4,
    },
  ],
  nextPractice: {
    focus: "前足の軌道",
    drill: "低いオーリーを10回、前足の動きだけに集中して反復する。",
  },
  safetyNote: "周囲に十分なスペースを確保して練習してください。",
} satisfies SkateAnalysisResult;

const fixtureDefinitions: readonly FixtureDefinition[] = [
  {
    slug: "ollie",
    daysAgo: 1,
    cameraAngle: "SIDE",
    userOutcome: "LANDED",
    analysisStatus: "COMPLETED",
    analysisResult: completedOllieResult,
  },
  {
    slug: "pop-shove-it",
    daysAgo: 3,
    cameraAngle: "DIAGONAL",
    userOutcome: "UNCLEAR",
    analysisStatus: "ANALYZING",
  },
  {
    slug: "kickflip",
    daysAgo: 7,
    cameraAngle: "FRONT",
    userOutcome: "BAILED",
    analysisStatus: "FAILED",
  },
];

function usage() {
  return [
    "Usage:",
    "  pnpm db:seed-dev insert --user-id <id> --confirm-dev-data",
    "  pnpm db:seed-dev delete --user-id <id> --confirm-dev-data",
  ].join("\n");
}

function parseArguments(argv: string[]) {
  const normalizedArguments = argv[0] === "--" ? argv.slice(1) : argv;
  const [action, ...options] = normalizedArguments;

  if (action !== "insert" && action !== "delete") {
    throw new Error(`Action must be insert or delete.\n${usage()}`);
  }

  const userIdIndex = options.indexOf("--user-id");
  const userId = userIdIndex >= 0 ? options[userIdIndex + 1] : undefined;
  const confirmed = options.includes(CONFIRMATION_FLAG);
  const knownOptions = new Set([
    "--user-id",
    userId ?? "",
    CONFIRMATION_FLAG,
  ]);
  const unknownOptions = options.filter((option) => !knownOptions.has(option));

  if (!userId || userId.startsWith("--")) {
    throw new Error(`--user-id is required.\n${usage()}`);
  }
  if (!confirmed) {
    throw new Error(
      `${CONFIRMATION_FLAG} is required to modify development fixture data.`,
    );
  }
  if (unknownOptions.length > 0) {
    throw new Error(`Unknown argument: ${unknownOptions.join(", ")}\n${usage()}`);
  }

  return { action, userId } satisfies { action: Action; userId: string };
}

function assertDevelopmentEnvironment() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  ) {
    throw new Error("Development fixtures are disabled in production.");
  }
}

async function requireExistingUser(userId: string) {
  const [targetUser] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!targetUser) {
    throw new Error(`User ${userId} does not exist.`);
  }

  return targetUser;
}

function fixtureMemo(slug: SupportedTrickSlug) {
  return `${FIXTURE_MARKER} ${slug}`;
}

async function deleteFixtures(userId: string) {
  return db.transaction(async (tx) => {
    const deletedSessions = await tx
      .delete(practiceSessions)
      .where(
        and(
          eq(practiceSessions.userId, userId),
          like(practiceSessions.memo, `${FIXTURE_MARKER}%`),
        ),
      )
      .returning({ id: practiceSessions.id });

    return deletedSessions.length;
  });
}

async function insertFixtures(userId: string) {
  for (const definition of fixtureDefinitions) {
    if (definition.analysisResult) {
      skateAnalysisResultSchema.parse(definition.analysisResult);
    }
  }

  const trickRows = await db
    .select({ id: tricks.id, slug: tricks.slug })
    .from(tricks)
    .where(eq(tricks.isActive, true));
  const trickIdBySlug = new Map(trickRows.map((trick) => [trick.slug, trick.id]));
  const missingTricks = fixtureDefinitions
    .map((definition) => definition.slug)
    .filter((slug) => !trickIdBySlug.has(slug));

  if (missingTricks.length > 0) {
    throw new Error(
      `Required active tricks are missing: ${missingTricks.join(", ")}. Run pnpm db:seed first.`,
    );
  }

  return db.transaction(async (tx) => {
    await tx
      .delete(practiceSessions)
      .where(
        and(
          eq(practiceSessions.userId, userId),
          like(practiceSessions.memo, `${FIXTURE_MARKER}%`),
        ),
      );

    const now = Date.now();

    for (const definition of fixtureDefinitions) {
      const sessionId = randomUUID();
      const videoId = randomUUID();
      const practicedAt = new Date(
        now - definition.daysAgo * 24 * 60 * 60 * 1_000,
      );
      const trickId = trickIdBySlug.get(definition.slug);

      if (!trickId) {
        throw new Error(`Missing trick ID for ${definition.slug}.`);
      }

      await tx.insert(practiceSessions).values({
        id: sessionId,
        userId,
        trickId,
        practicedAt,
        cameraAngle: definition.cameraAngle,
        userOutcome: definition.userOutcome,
        memo: fixtureMemo(definition.slug),
      });
      await tx.insert(videos).values({
        id: videoId,
        sessionId,
        s3Key: `dev-fixtures/${encodeURIComponent(userId)}/${sessionId}/${videoId}.mp4`,
        originalFilename: `${definition.slug}-slow-motion.mp4`,
        contentType: "video/mp4",
        fileSize: 8_000_000 + definition.daysAgo * 100_000,
        durationMs: 6_000 + definition.daysAgo * 250,
        width: 1_920,
        height: 1_080,
        status: "READY",
      });
      await tx.insert(analyses).values({
        videoId,
        provider: "development-fixture",
        modelId: "fixture-v1",
        promptVersion: "dev-fixture-v1",
        status: definition.analysisStatus,
        resultJson: definition.analysisResult ?? null,
        errorCode:
          definition.analysisStatus === "FAILED" ? "FIXTURE_FAILURE" : null,
        errorMessage:
          definition.analysisStatus === "FAILED"
            ? "開発用フィクスチャの分析失敗です。"
            : null,
        attemptCount: 1,
        startedAt:
          definition.analysisStatus === "ANALYZING" ||
          definition.analysisStatus === "COMPLETED"
            ? practicedAt
            : null,
        completedAt:
          definition.analysisStatus === "COMPLETED"
            ? new Date(practicedAt.getTime() + 90_000)
            : null,
      });
    }

    return fixtureDefinitions.length;
  });
}

async function main() {
  assertDevelopmentEnvironment();
  const { action, userId } = parseArguments(process.argv.slice(2));
  const targetUser = await requireExistingUser(userId);

  if (action === "delete") {
    const deletedCount = await deleteFixtures(userId);
    console.log(
      `Deleted ${deletedCount} development fixture session(s) for ${targetUser.email}.`,
    );
    return;
  }

  const insertedCount = await insertFixtures(userId);
  console.log(
    `Inserted ${insertedCount} development fixture session(s) for ${targetUser.email}.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
