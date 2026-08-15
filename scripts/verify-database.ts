import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";

import { db, pool as runtimePool } from "@/lib/db";
import {
  analyses,
  practiceSessions,
  tricks,
  user,
  videos,
} from "@/lib/db/schema";

const expectedTables = [
  "account",
  "analyses",
  "session",
  "sessions",
  "tricks",
  "user",
  "verification",
  "videos",
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function requiredEnvironment(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set. Add it to .env.local.`);
  }

  return value;
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }

  if ("cause" in error) {
    return postgresErrorCode(error.cause);
  }

  return undefined;
}

function validateConnectionPurpose(input: {
  name: string;
  url: string;
  expectedPort: string;
}) {
  const parsed = new URL(input.url);
  const port = parsed.port || "5432";

  if (port !== input.expectedPort) {
    throw new Error(
      `${input.name} must use port ${input.expectedPort}, but it uses ${port}.`,
    );
  }
}

async function verifyConnection(input: {
  label: string;
  connectionString: string;
  verifySchema: boolean;
}) {
  const pool = new Pool({
    connectionString: input.connectionString,
    connectionTimeoutMillis: 10_000,
    max: 1,
  });
  const startedAt = performance.now();

  try {
    await pool.query("select 1");

    if (input.verifySchema) {
      const result = await pool.query<{ table_name: string }>(
        `select table_name
         from information_schema.tables
         where table_schema = 'public' and table_name = any($1::text[])
         order by table_name`,
        [expectedTables],
      );
      const found = new Set(result.rows.map((row) => row.table_name));
      const missing = expectedTables.filter((table) => !found.has(table));

      if (missing.length > 0) {
        throw new Error(`Missing database tables: ${missing.join(", ")}`);
      }
    }

    console.log(
      `${input.label} connection verified (${Math.round(performance.now() - startedAt)}ms).`,
    );
  } finally {
    await pool.end();
  }
}

async function verifyRuntimeDrizzleCrudAndTransaction() {
  const verificationId = randomUUID();
  const ids = {
    user: `db-verify-${verificationId}`,
    session: randomUUID(),
    video: randomUUID(),
    analysis: randomUUID(),
    deletedAnalysis: randomUUID(),
  };
  const rollbackSignal = new Error("ROLLBACK_DATABASE_VERIFICATION");

  try {
    await db.transaction(async (tx) => {
      const [selectedTrick] = await tx
        .select({ id: tricks.id })
        .from(tricks)
        .limit(1);

      assert(selectedTrick, "No seeded trick is available for CRUD verification.");

      await tx.insert(user).values({
        id: ids.user,
        display_name: "Database verification user",
        email: `${ids.user}@example.invalid`,
        emailVerified: true,
      });
      await tx.insert(practiceSessions).values({
        id: ids.session,
        userId: ids.user,
        trickId: selectedTrick.id,
        cameraAngle: "SIDE",
        userOutcome: "UNCLEAR",
        memo: "Database verification session",
      });
      await tx.insert(videos).values({
        id: ids.video,
        sessionId: ids.session,
        s3Key: `database-verification/${verificationId}.mp4`,
        originalFilename: "database-verification.mp4",
        contentType: "video/mp4",
        fileSize: 1,
        durationMs: 3_000,
        width: 1,
        height: 1,
        status: "UPLOADED",
      });
      await tx.insert(analyses).values([
        {
          id: ids.analysis,
          videoId: ids.video,
          provider: "database-verification",
          modelId: "database-verification",
          promptVersion: "database-verification",
        },
        {
          id: ids.deletedAnalysis,
          videoId: ids.video,
          provider: "database-verification-delete",
          modelId: "database-verification",
          promptVersion: "database-verification",
        },
      ]);

      const [insertedGraph] = await tx
        .select({
          userId: user.id,
          sessionId: practiceSessions.id,
          videoId: videos.id,
          analysisId: analyses.id,
        })
        .from(user)
        .innerJoin(practiceSessions, eq(practiceSessions.userId, user.id))
        .innerJoin(videos, eq(videos.sessionId, practiceSessions.id))
        .innerJoin(analyses, eq(analyses.videoId, videos.id))
        .where(eq(analyses.id, ids.analysis));

      assert(
        insertedGraph?.userId === ids.user &&
          insertedGraph.sessionId === ids.session &&
          insertedGraph.videoId === ids.video &&
          insertedGraph.analysisId === ids.analysis,
        "Drizzle could not read the inserted verification graph.",
      );

      const [updatedUser] = await tx
        .update(user)
        .set({ display_name: "Updated database verification user" })
        .where(eq(user.id, ids.user))
        .returning({ id: user.id });
      const [updatedSession] = await tx
        .update(practiceSessions)
        .set({ memo: "Updated database verification session" })
        .where(eq(practiceSessions.id, ids.session))
        .returning({ id: practiceSessions.id });
      const [updatedVideo] = await tx
        .update(videos)
        .set({ status: "READY" })
        .where(eq(videos.id, ids.video))
        .returning({ id: videos.id });
      const [updatedAnalysis] = await tx
        .update(analyses)
        .set({ status: "ANALYZING", attemptCount: 1 })
        .where(eq(analyses.id, ids.analysis))
        .returning({ id: analyses.id });

      assert(updatedUser?.id === ids.user, "Drizzle could not update the user.");
      assert(
        updatedSession?.id === ids.session,
        "Drizzle could not update the practice session.",
      );
      assert(updatedVideo?.id === ids.video, "Drizzle could not update the video.");
      assert(
        updatedAnalysis?.id === ids.analysis,
        "Drizzle could not update the analysis.",
      );

      const [deletedAnalysis] = await tx
        .delete(analyses)
        .where(eq(analyses.id, ids.deletedAnalysis))
        .returning({ id: analyses.id });

      assert(
        deletedAnalysis?.id === ids.deletedAnalysis,
        "Drizzle could not delete the verification analysis.",
      );

      throw rollbackSignal;
    });
  } catch (error) {
    if (error !== rollbackSignal) {
      throw error;
    }
  }

  const remainingRows = await Promise.all([
    db.select({ id: user.id }).from(user).where(eq(user.id, ids.user)),
    db
      .select({ id: practiceSessions.id })
      .from(practiceSessions)
      .where(eq(practiceSessions.id, ids.session)),
    db.select({ id: videos.id }).from(videos).where(eq(videos.id, ids.video)),
    db
      .select({ id: analyses.id })
      .from(analyses)
      .where(eq(analyses.id, ids.analysis)),
    db
      .select({ id: analyses.id })
      .from(analyses)
      .where(eq(analyses.id, ids.deletedAnalysis)),
  ]);

  assert(
    remainingRows.every((rows) => rows.length === 0),
    "Transaction rollback left verification data in the database.",
  );

  console.log("Runtime Drizzle CRUD verified without named prepared statements.");
  console.log("Runtime transaction rollback verified; no verification data remains.");
}

async function verifyRuntimeRoleAndDdl(appRole: string) {
  const identity = await runtimePool.query<{ current_user: string }>(
    "select current_user",
  );
  const currentUser = identity.rows[0]?.current_user;

  assert(currentUser !== "postgres", "Runtime connection must not use postgres.");
  assert(
    currentUser === appRole,
    `Runtime connection must use the configured app role ${appRole}.`,
  );

  const ddlTableName = `database_verification_ddl_${randomUUID().replaceAll("-", "")}`;
  const rollbackSignal = new Error("ROLLBACK_DDL_VERIFICATION");
  let ddlWasAllowed = false;
  let ddlWasDenied = false;

  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql.raw(`create table public.${ddlTableName} (id integer)`),
      );
      ddlWasAllowed = true;
      throw rollbackSignal;
    });
  } catch (error) {
    if (error === rollbackSignal) {
      // The successful DDL was rolled back and is reported as a verification failure below.
    } else if (postgresErrorCode(error) === "42501") {
      ddlWasDenied = true;
    } else {
      throw error;
    }
  }

  assert(!ddlWasAllowed, "Runtime app role unexpectedly has DDL permission.");
  assert(ddlWasDenied, "Runtime app role DDL was not rejected as expected.");

  console.log(`Runtime database role verified: ${currentUser}.`);
  console.log("Runtime app role DDL rejection verified (insufficient privilege).");
}

async function main() {
  const runtimeUrl = requiredEnvironment("DATABASE_URL");
  const adminUrl = requiredEnvironment("DATABASE_ADMIN_URL");
  const appRole = requiredEnvironment("APP_DB_ROLE");

  validateConnectionPurpose({
    name: "DATABASE_URL",
    url: runtimeUrl,
    expectedPort: "6543",
  });
  validateConnectionPurpose({
    name: "DATABASE_ADMIN_URL",
    url: adminUrl,
    expectedPort: "5432",
  });

  try {
    await verifyConnection({
      label: "Admin/direct",
      connectionString: adminUrl,
      verifySchema: true,
    });
    await verifyConnection({
      label: "Runtime/transaction-pooler",
      connectionString: runtimeUrl,
      verifySchema: true,
    });
    await verifyRuntimeRoleAndDdl(appRole);
    await verifyRuntimeDrizzleCrudAndTransaction();
  } finally {
    await runtimePool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
});
