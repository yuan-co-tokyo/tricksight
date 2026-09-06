import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";

import { db, pool as runtimePool } from "@/lib/db";
import {
  expectedPublicTables,
  verifyPublicSchemaSecurity,
} from "@/lib/db/public-schema-security";
import {
  account,
  analyses,
  practiceSessions,
  session as authSession,
  tricks,
  user,
  verification,
  videos,
} from "@/lib/db/schema";

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
        [expectedPublicTables],
      );
      const found = new Set(result.rows.map((row) => row.table_name));
      const missing = expectedPublicTables.filter((table) => !found.has(table));

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

async function verifyAdminSecurity(connectionString: string, appRole: string) {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 10_000,
    max: 1,
  });

  try {
    const client = await pool.connect();

    try {
      const securedTables = await verifyPublicSchemaSecurity(client, appRole);

      console.log(
        `RLS and app-role policies verified on ${securedTables.length} public table(s).`,
      );
      console.log(
        "anon/authenticated current and default table privileges verified as absent.",
      );
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function verifyRuntimeDrizzleCrudAndTransaction() {
  const verificationId = randomUUID();
  const now = new Date();
  const ids = {
    user: `db-verify-${verificationId}`,
    authSession: `db-verify-session-${verificationId}`,
    account: `db-verify-account-${verificationId}`,
    verification: `db-verify-verification-${verificationId}`,
    trick: randomUUID(),
    practiceSession: randomUUID(),
    video: randomUUID(),
    analysis: randomUUID(),
  };
  const rollbackSignal = new Error("ROLLBACK_DATABASE_VERIFICATION");

  try {
    await db.transaction(async (tx) => {
      await tx.insert(user).values({
        id: ids.user,
        display_name: "Database verification user",
        email: `${ids.user}@example.invalid`,
        emailVerified: true,
      });
      await tx.insert(tricks).values({
        id: ids.trick,
        slug: `db-verify-${verificationId}`,
        name: "Database verification trick",
      });
      await tx.insert(authSession).values({
        id: ids.authSession,
        expiresAt: new Date(now.getTime() + 60_000),
        token: `db-verify-token-${verificationId}`,
        updatedAt: now,
        userId: ids.user,
      });
      await tx.insert(account).values({
        id: ids.account,
        accountId: ids.user,
        providerId: "credential",
        userId: ids.user,
        updatedAt: now,
      });
      await tx.insert(verification).values({
        id: ids.verification,
        identifier: `${ids.user}@example.invalid`,
        value: "database-verification",
        expiresAt: new Date(now.getTime() + 60_000),
      });
      await tx.insert(practiceSessions).values({
        id: ids.practiceSession,
        userId: ids.user,
        trickId: ids.trick,
        cameraAngle: "SIDE",
        userOutcome: "UNCLEAR",
        memo: "Database verification session",
      });
      await tx.insert(videos).values({
        id: ids.video,
        sessionId: ids.practiceSession,
        s3Key: `database-verification/${verificationId}.mp4`,
        originalFilename: "database-verification.mp4",
        contentType: "video/mp4",
        fileSize: 1,
        durationMs: 3_000,
        width: 1,
        height: 1,
        status: "UPLOADED",
      });
      await tx.insert(analyses).values({
        id: ids.analysis,
        videoId: ids.video,
        provider: "database-verification",
        modelId: "database-verification",
        promptVersion: "database-verification",
      });

      const selectedRows: Array<Array<{ id: string }>> = [];
      selectedRows.push(
        await tx.select({ id: user.id }).from(user).where(eq(user.id, ids.user)),
      );
      selectedRows.push(
        await tx
          .select({ id: authSession.id })
          .from(authSession)
          .where(eq(authSession.id, ids.authSession)),
      );
      selectedRows.push(
        await tx
          .select({ id: account.id })
          .from(account)
          .where(eq(account.id, ids.account)),
      );
      selectedRows.push(
        await tx
          .select({ id: verification.id })
          .from(verification)
          .where(eq(verification.id, ids.verification)),
      );
      selectedRows.push(
        await tx
          .select({ id: tricks.id })
          .from(tricks)
          .where(eq(tricks.id, ids.trick)),
      );
      selectedRows.push(
        await tx
          .select({ id: practiceSessions.id })
          .from(practiceSessions)
          .where(eq(practiceSessions.id, ids.practiceSession)),
      );
      selectedRows.push(
        await tx
          .select({ id: videos.id })
          .from(videos)
          .where(eq(videos.id, ids.video)),
      );
      selectedRows.push(
        await tx
          .select({ id: analyses.id })
          .from(analyses)
          .where(eq(analyses.id, ids.analysis)),
      );

      assert(
        selectedRows.every((rows) => rows.length === 1),
        "Drizzle could not read every inserted verification row.",
      );

      const updatedRows: Array<Array<{ id: string }>> = [];
      updatedRows.push(
        await tx
          .update(user)
          .set({ display_name: "Updated database verification user" })
          .where(eq(user.id, ids.user))
          .returning({ id: user.id }),
      );
      updatedRows.push(
        await tx
          .update(authSession)
          .set({ userAgent: "database-verification" })
          .where(eq(authSession.id, ids.authSession))
          .returning({ id: authSession.id }),
      );
      updatedRows.push(
        await tx
          .update(account)
          .set({ scope: "database-verification" })
          .where(eq(account.id, ids.account))
          .returning({ id: account.id }),
      );
      updatedRows.push(
        await tx
          .update(verification)
          .set({ value: "updated-database-verification" })
          .where(eq(verification.id, ids.verification))
          .returning({ id: verification.id }),
      );
      updatedRows.push(
        await tx
          .update(tricks)
          .set({ description: "Updated database verification trick" })
          .where(eq(tricks.id, ids.trick))
          .returning({ id: tricks.id }),
      );
      updatedRows.push(
        await tx
          .update(practiceSessions)
          .set({ memo: "Updated database verification session" })
          .where(eq(practiceSessions.id, ids.practiceSession))
          .returning({ id: practiceSessions.id }),
      );
      updatedRows.push(
        await tx
          .update(videos)
          .set({ status: "READY" })
          .where(eq(videos.id, ids.video))
          .returning({ id: videos.id }),
      );
      updatedRows.push(
        await tx
          .update(analyses)
          .set({ status: "ANALYZING", attemptCount: 1 })
          .where(eq(analyses.id, ids.analysis))
          .returning({ id: analyses.id }),
      );

      assert(
        updatedRows.every((rows) => rows.length === 1),
        "Drizzle could not update every verification row.",
      );

      const deletedRows: Array<Array<{ id: string }>> = [];
      deletedRows.push(
        await tx
          .delete(analyses)
          .where(eq(analyses.id, ids.analysis))
          .returning({ id: analyses.id }),
      );
      deletedRows.push(
        await tx
          .delete(videos)
          .where(eq(videos.id, ids.video))
          .returning({ id: videos.id }),
      );
      deletedRows.push(
        await tx
          .delete(practiceSessions)
          .where(eq(practiceSessions.id, ids.practiceSession))
          .returning({ id: practiceSessions.id }),
      );
      deletedRows.push(
        await tx
          .delete(authSession)
          .where(eq(authSession.id, ids.authSession))
          .returning({ id: authSession.id }),
      );
      deletedRows.push(
        await tx
          .delete(account)
          .where(eq(account.id, ids.account))
          .returning({ id: account.id }),
      );
      deletedRows.push(
        await tx
          .delete(verification)
          .where(eq(verification.id, ids.verification))
          .returning({ id: verification.id }),
      );
      deletedRows.push(
        await tx
          .delete(tricks)
          .where(eq(tricks.id, ids.trick))
          .returning({ id: tricks.id }),
      );
      deletedRows.push(
        await tx
          .delete(user)
          .where(eq(user.id, ids.user))
          .returning({ id: user.id }),
      );
      assert(
        deletedRows.every((rows) => rows.length === 1),
        "Drizzle could not delete every verification row.",
      );

      throw rollbackSignal;
    });
  } catch (error) {
    if (error !== rollbackSignal) {
      throw error;
    }
  }

  const remainingRows: Array<Array<{ id: string }>> = [];
  remainingRows.push(
    await db.select({ id: user.id }).from(user).where(eq(user.id, ids.user)),
  );
  remainingRows.push(
    await db
      .select({ id: authSession.id })
      .from(authSession)
      .where(eq(authSession.id, ids.authSession)),
  );
  remainingRows.push(
    await db
      .select({ id: account.id })
      .from(account)
      .where(eq(account.id, ids.account)),
  );
  remainingRows.push(
    await db
      .select({ id: verification.id })
      .from(verification)
      .where(eq(verification.id, ids.verification)),
  );
  remainingRows.push(
    await db
      .select({ id: tricks.id })
      .from(tricks)
      .where(eq(tricks.id, ids.trick)),
  );
  remainingRows.push(
    await db
      .select({ id: practiceSessions.id })
      .from(practiceSessions)
      .where(eq(practiceSessions.id, ids.practiceSession)),
  );
  remainingRows.push(
    await db
      .select({ id: videos.id })
      .from(videos)
      .where(eq(videos.id, ids.video)),
  );
  remainingRows.push(
    await db
      .select({ id: analyses.id })
      .from(analyses)
      .where(eq(analyses.id, ids.analysis)),
  );

  assert(
    remainingRows.every((rows) => rows.length === 0),
    "Transaction rollback left verification data in the database.",
  );

  console.log(
    "Runtime Drizzle CRUD verified on all 8 public tables without named prepared statements.",
  );
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
  const appRole = requiredEnvironment("APP_DB_ROLE");
  const runtimeOnly = process.argv.includes("--runtime-only");

  validateConnectionPurpose({
    name: "DATABASE_URL",
    url: runtimeUrl,
    expectedPort: "6543",
  });
  const adminUrl = runtimeOnly
    ? undefined
    : requiredEnvironment("DATABASE_ADMIN_URL");

  if (adminUrl) {
    validateConnectionPurpose({
      name: "DATABASE_ADMIN_URL",
      url: adminUrl,
      expectedPort: "5432",
    });
  }

  try {
    if (adminUrl) {
      await verifyConnection({
        label: "Admin/direct",
        connectionString: adminUrl,
        verifySchema: true,
      });
    }
    await verifyConnection({
      label: "Runtime/transaction-pooler",
      connectionString: runtimeUrl,
      verifySchema: true,
    });
    await verifyRuntimeRoleAndDdl(appRole);
    await verifyRuntimeDrizzleCrudAndTransaction();

    if (adminUrl) {
      await verifyAdminSecurity(adminUrl, appRole);
    }
  } finally {
    await runtimePool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
});
