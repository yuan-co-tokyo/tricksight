import { Pool } from "pg";

import {
  configurePublicSchemaSecurity,
  rollbackPublicSchemaRls,
} from "@/lib/db/public-schema-security";

function requiredEnvironment(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set. Add it to .env.local.`);
  }

  return value;
}

function validateAdminConnection(url: string) {
  const parsed = new URL(url);
  const port = parsed.port || "5432";

  if (port !== "5432") {
    throw new Error(
      `DATABASE_ADMIN_URL must use a direct or session-pooler connection on port 5432, but it uses ${port}.`,
    );
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const rollbackRls = process.argv.includes("--rollback-rls");

  if (apply === rollbackRls) {
    throw new Error(
      "Specify exactly one operation: --apply or --rollback-rls.",
    );
  }

  const adminUrl = requiredEnvironment("DATABASE_ADMIN_URL");
  const appRole = requiredEnvironment("APP_DB_ROLE");

  validateAdminConnection(adminUrl);

  const pool = new Pool({
    connectionString: adminUrl,
    connectionTimeoutMillis: 10_000,
    max: 1,
  });

  try {
    const client = await pool.connect();

    try {
      await client.query("begin");
      const affectedTables = apply
        ? await configurePublicSchemaSecurity(client, appRole)
        : await rollbackPublicSchemaRls(client, appRole);
      await client.query("commit");

      if (apply) {
        console.log(
          `Public schema security applied atomically to ${affectedTables.length} table(s).`,
        );
        console.log(
          "Verified tricksight_app CRUD under RLS before committing; verification rows were rolled back.",
        );
        console.log(
          "Revoked current and default privileges from anon/authenticated.",
        );
        console.log("Enabled RLS and installed the tricksight_app policy.");
        console.log("service_role privileges were not modified.");
      } else {
        console.log(
          `Emergency RLS rollback applied atomically to ${affectedTables.length} table(s).`,
        );
        console.log("Disabled RLS and removed the tricksight_app policy.");
        console.log(
          "anon/authenticated current and default privilege revocations remain in place.",
        );
      }
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
});
