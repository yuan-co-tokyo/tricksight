import { Pool, type PoolClient } from "pg";

import { configurePublicSchemaSecurity } from "@/lib/db/public-schema-security";

function requiredEnvironment(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set. Add it to .env.local.`);
  }

  return value;
}

async function quotedRoleCredentials(
  client: PoolClient,
  role: string,
  password: string,
) {
  const result = await client.query<{
    role_identifier: string;
    password_literal: string;
  }>(
    `select quote_ident($1) as role_identifier,
            quote_literal($2) as password_literal`,
    [role, password],
  );
  const credentials = result.rows[0];

  if (!credentials) {
    throw new Error("Could not safely quote the app database role credentials.");
  }

  return credentials;
}

async function configureRole(client: PoolClient, role: string, password: string) {
  const identity = await client.query<{ current_user: string }>(
    "select current_user",
  );

  if (identity.rows[0]?.current_user !== "postgres") {
    throw new Error("DATABASE_ADMIN_URL must connect as the postgres role.");
  }

  const { role_identifier: roleIdentifier, password_literal: passwordLiteral } =
    await quotedRoleCredentials(client, role, password);
  const roleResult = await client.query<{ exists: boolean }>(
    "select exists(select 1 from pg_roles where rolname = $1)",
    [role],
  );
  const roleExists = roleResult.rows[0]?.exists === true;

  if (roleExists) {
    // Supabaseのpostgresはsuperuserではないため、ALTERではnosuperuserを指定できない。
    await client.query(
      `alter role ${roleIdentifier} with login password ${passwordLiteral}
       nocreatedb nocreaterole noreplication nobypassrls`,
    );
  } else {
    await client.query(
      `create role ${roleIdentifier} with login password ${passwordLiteral}
       nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
    );
  }

  await client.query(`grant usage on schema public to ${roleIdentifier}`);
  await client.query(`revoke create on schema public from ${roleIdentifier}`);
  await client.query(
    `grant select, insert, update, delete on all tables in schema public
     to ${roleIdentifier}`,
  );
  await client.query(
    `grant usage, select on all sequences in schema public to ${roleIdentifier}`,
  );
  await client.query(
    `alter default privileges for role postgres in schema public
     grant select, insert, update, delete on tables to ${roleIdentifier}`,
  );
  await client.query(
    `alter default privileges for role postgres in schema public
     grant usage, select on sequences to ${roleIdentifier}`,
  );

  const attributes = await client.query<{
    rolcanlogin: boolean;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
  }>(
    `select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
            rolreplication, rolbypassrls
     from pg_roles
     where rolname = $1`,
    [role],
  );
  const configured = attributes.rows[0];

  if (
    !configured?.rolcanlogin ||
    configured.rolsuper ||
    configured.rolcreatedb ||
    configured.rolcreaterole ||
    configured.rolreplication ||
    configured.rolbypassrls
  ) {
    throw new Error("The app database role has unexpected role attributes.");
  }

  return roleExists ? "updated" : "created";
}

async function main() {
  const adminUrl = requiredEnvironment("DATABASE_ADMIN_URL");
  const appRole = requiredEnvironment("APP_DB_ROLE");
  const appPassword = requiredEnvironment("APP_DB_PASSWORD");
  const pool = new Pool({
    connectionString: adminUrl,
    connectionTimeoutMillis: 10_000,
    max: 1,
  });

  try {
    const client = await pool.connect();

    try {
      await client.query("begin");
      const action = await configureRole(client, appRole, appPassword);
      const securedTables = await configurePublicSchemaSecurity(client, appRole);
      await client.query("commit");
      console.log(`App database role ${action}: ${appRole}.`);
      console.log("Granted DML on public tables and usage on public sequences.");
      console.log("Configured matching default privileges for future migrations.");
      console.log(
        `Secured ${securedTables.length} public table(s) with revoked Data API privileges and RLS.`,
      );
      console.log("DDL and elevated role attributes were not granted.");
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
