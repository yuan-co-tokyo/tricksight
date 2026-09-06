import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

export const expectedPublicTables = [
  "account",
  "analyses",
  "session",
  "sessions",
  "tricks",
  "user",
  "verification",
  "videos",
] as const;

const dataApiRoles = ["anon", "authenticated"] as const;
const applicationPolicyName = "tricksight_app_full_access";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function quoteIdentifier(client: PoolClient, identifier: string) {
  const result = await client.query<{ quoted_identifier: string }>(
    "select quote_ident($1) as quoted_identifier",
    [identifier],
  );
  const quotedIdentifier = result.rows[0]?.quoted_identifier;

  assert(quotedIdentifier, `Could not safely quote identifier: ${identifier}`);

  return quotedIdentifier;
}

async function listPublicTables(client: PoolClient) {
  const result = await client.query<{ table_name: string }>(
    `select c.relname as table_name
     from pg_class c
     inner join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
     order by c.relname`,
  );

  return result.rows.map((row) => row.table_name);
}

function assertExpectedTableSet(publicTables: string[]) {
  const foundTables = new Set(publicTables);
  const missingTables = expectedPublicTables.filter(
    (table) => !foundTables.has(table),
  );
  const expectedTables = new Set<string>(expectedPublicTables);
  const unexpectedTables = publicTables.filter(
    (table) => !expectedTables.has(table),
  );

  assert(
    missingTables.length === 0,
    `Missing database tables: ${missingTables.join(", ")}`,
  );
  assert(
    unexpectedTables.length === 0,
    `Unexpected public tables require an explicit security review: ${unexpectedTables.join(", ")}`,
  );
}

async function assertAffectedOne(
  client: PoolClient,
  text: string,
  values: unknown[],
  operation: string,
) {
  const result = await client.query(text, values);

  assert(result.rowCount === 1, `${operation} did not affect exactly one row.`);
}

async function verifyAppRoleCrudInsideTransaction(
  client: PoolClient,
  appRole: string,
  roleIdentifier: string,
) {
  const verificationId = randomUUID();
  const ids = {
    user: `security-verify-user-${verificationId}`,
    authSession: `security-verify-session-${verificationId}`,
    account: `security-verify-account-${verificationId}`,
    verification: `security-verify-verification-${verificationId}`,
    trick: randomUUID(),
    practiceSession: randomUUID(),
    video: randomUUID(),
    analysis: randomUUID(),
  };
  const savepoint = "tricksight_app_rls_verification";
  const membershipResult = await client.query<{
    admin_option: boolean;
    inherit_option: boolean;
    set_option: boolean;
  }>(
    `select m.admin_option, m.inherit_option, m.set_option
     from pg_auth_members m
     inner join pg_roles granted_role on granted_role.oid = m.roleid
     inner join pg_roles member_role on member_role.oid = m.member
     where granted_role.rolname = $1
       and member_role.rolname = current_user`,
    [appRole],
  );
  const originalMembership = membershipResult.rows[0];

  assert(
    originalMembership?.admin_option,
    `postgres must hold ADMIN OPTION on ${appRole} for atomic RLS verification.`,
  );

  await client.query(`savepoint ${savepoint}`);

  try {
    if (!originalMembership.set_option) {
      // PostgreSQL 16ではCREATEROLEが作成したロールへのmembershipはSET FALSEが既定。
      // savepoint内だけSET TRUEにし、rollbackで元のmembershipオプションへ戻す。
      await client.query(
        `grant ${roleIdentifier} to postgres with set true`,
      );
    }

    await client.query(`set local role ${roleIdentifier}`);

    await assertAffectedOne(
      client,
      `insert into public."user"
       (id, display_name, email, email_verified)
       values ($1, $2, $3, true)`,
      [ids.user, "Security verification user", `${ids.user}@example.invalid`],
      "user insert",
    );
    await assertAffectedOne(
      client,
      `insert into public.tricks (id, slug, name)
       values ($1, $2, $3)`,
      [ids.trick, `security-verify-${verificationId}`, "Security verification trick"],
      "tricks insert",
    );
    await assertAffectedOne(
      client,
      `insert into public."session"
       (id, expires_at, token, updated_at, user_id)
       values ($1, now() + interval '1 minute', $2, now(), $3)`,
      [ids.authSession, `security-verify-token-${verificationId}`, ids.user],
      "session insert",
    );
    await assertAffectedOne(
      client,
      `insert into public.account
       (id, account_id, provider_id, user_id, updated_at)
       values ($1, $2, 'credential', $2, now())`,
      [ids.account, ids.user],
      "account insert",
    );
    await assertAffectedOne(
      client,
      `insert into public.verification
       (id, identifier, value, expires_at)
       values ($1, $2, 'security-verification', now() + interval '1 minute')`,
      [ids.verification, `${ids.user}@example.invalid`],
      "verification insert",
    );
    await assertAffectedOne(
      client,
      `insert into public.sessions
       (id, user_id, trick_id, camera_angle, user_outcome)
       values ($1, $2, $3, 'SIDE', 'UNCLEAR')`,
      [ids.practiceSession, ids.user, ids.trick],
      "sessions insert",
    );
    await assertAffectedOne(
      client,
      `insert into public.videos
       (id, session_id, s3_key, original_filename, content_type, file_size, status)
       values ($1, $2, $3, 'security-verification.mp4', 'video/mp4', 1, 'UPLOADED')`,
      [
        ids.video,
        ids.practiceSession,
        `security-verification/${verificationId}.mp4`,
      ],
      "videos insert",
    );
    await assertAffectedOne(
      client,
      `insert into public.analyses
       (id, video_id, provider, model_id, prompt_version)
       values ($1, $2, 'security-verification', 'security-verification', 'security-verification')`,
      [ids.analysis, ids.video],
      "analyses insert",
    );

    const selected = await client.query<{ all_rows_found: boolean }>(
      `select
         exists(select 1 from public."user" where id = $1)
         and exists(select 1 from public."session" where id = $2)
         and exists(select 1 from public.account where id = $3)
         and exists(select 1 from public.verification where id = $4)
         and exists(select 1 from public.tricks where id = $5)
         and exists(select 1 from public.sessions where id = $6)
         and exists(select 1 from public.videos where id = $7)
         and exists(select 1 from public.analyses where id = $8)
         as all_rows_found`,
      [
        ids.user,
        ids.authSession,
        ids.account,
        ids.verification,
        ids.trick,
        ids.practiceSession,
        ids.video,
        ids.analysis,
      ],
    );

    assert(
      selected.rows[0]?.all_rows_found,
      `${appRole} could not select every RLS verification row.`,
    );

    await assertAffectedOne(
      client,
      `update public."user" set display_name = 'Updated security verification user'
       where id = $1`,
      [ids.user],
      "user update",
    );
    await assertAffectedOne(
      client,
      `update public."session" set user_agent = 'security-verification'
       where id = $1`,
      [ids.authSession],
      "session update",
    );
    await assertAffectedOne(
      client,
      `update public.account set scope = 'security-verification' where id = $1`,
      [ids.account],
      "account update",
    );
    await assertAffectedOne(
      client,
      `update public.verification set value = 'updated-security-verification'
       where id = $1`,
      [ids.verification],
      "verification update",
    );
    await assertAffectedOne(
      client,
      `update public.tricks set description = 'Updated security verification trick'
       where id = $1`,
      [ids.trick],
      "tricks update",
    );
    await assertAffectedOne(
      client,
      `update public.sessions set memo = 'Updated security verification session'
       where id = $1`,
      [ids.practiceSession],
      "sessions update",
    );
    await assertAffectedOne(
      client,
      `update public.videos set status = 'READY' where id = $1`,
      [ids.video],
      "videos update",
    );
    await assertAffectedOne(
      client,
      `update public.analyses set status = 'ANALYZING', attempt_count = 1
       where id = $1`,
      [ids.analysis],
      "analyses update",
    );

    await assertAffectedOne(
      client,
      "delete from public.analyses where id = $1",
      [ids.analysis],
      "analyses delete",
    );
    await assertAffectedOne(
      client,
      "delete from public.videos where id = $1",
      [ids.video],
      "videos delete",
    );
    await assertAffectedOne(
      client,
      "delete from public.sessions where id = $1",
      [ids.practiceSession],
      "sessions delete",
    );
    await assertAffectedOne(
      client,
      `delete from public."session" where id = $1`,
      [ids.authSession],
      "session delete",
    );
    await assertAffectedOne(
      client,
      "delete from public.account where id = $1",
      [ids.account],
      "account delete",
    );
    await assertAffectedOne(
      client,
      "delete from public.verification where id = $1",
      [ids.verification],
      "verification delete",
    );
    await assertAffectedOne(
      client,
      "delete from public.tricks where id = $1",
      [ids.trick],
      "tricks delete",
    );
    await assertAffectedOne(
      client,
      `delete from public."user" where id = $1`,
      [ids.user],
      "user delete",
    );
  } finally {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
  }

  const identity = await client.query<{ current_user: string }>(
    "select current_user",
  );

  assert(
    identity.rows[0]?.current_user === "postgres",
    "ROLLBACK TO SAVEPOINT did not restore the postgres role.",
  );

  const restoredMembership = await client.query<{
    admin_option: boolean;
    inherit_option: boolean;
    set_option: boolean;
  }>(
    `select m.admin_option, m.inherit_option, m.set_option
     from pg_auth_members m
     inner join pg_roles granted_role on granted_role.oid = m.roleid
     inner join pg_roles member_role on member_role.oid = m.member
     where granted_role.rolname = $1
       and member_role.rolname = current_user`,
    [appRole],
  );

  const restored = restoredMembership.rows[0];

  assert(
    restored?.admin_option === originalMembership.admin_option &&
      restored.inherit_option === originalMembership.inherit_option &&
      restored.set_option === originalMembership.set_option,
    "RLS verification did not restore the original postgres role membership.",
  );
}

export async function verifyPublicSchemaSecurity(
  client: PoolClient,
  appRole: string,
) {
  const publicTables = await listPublicTables(client);
  assertExpectedTableSet(publicTables);

  const roleResult = await client.query<{
    rolname: string;
    rolbypassrls: boolean;
  }>(
    `select rolname, rolbypassrls
     from pg_roles
     where rolname = any($1::text[])
     order by rolname`,
    [[...dataApiRoles, appRole]],
  );
  const foundRoles = new Set(roleResult.rows.map((row) => row.rolname));
  const missingRoles = [...dataApiRoles, appRole].filter(
    (role) => !foundRoles.has(role),
  );

  assert(
    missingRoles.length === 0,
    `Missing database roles: ${missingRoles.join(", ")}`,
  );
  assert(
    roleResult.rows.find((role) => role.rolname === appRole)?.rolbypassrls ===
      false,
    `${appRole} must not bypass RLS.`,
  );

  const tableSecurity = await client.query<{
    table_name: string;
    rls_enabled: boolean;
    anon_has_privilege: boolean;
    authenticated_has_privilege: boolean;
    app_has_required_privileges: boolean;
    app_is_owner: boolean;
  }>(
    `select c.relname as table_name,
            c.relrowsecurity as rls_enabled,
            has_table_privilege(
              'anon', c.oid,
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
            ) as anon_has_privilege,
            has_table_privilege(
              'authenticated', c.oid,
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
            ) as authenticated_has_privilege,
            has_table_privilege($1, c.oid, 'SELECT')
              and has_table_privilege($1, c.oid, 'INSERT')
              and has_table_privilege($1, c.oid, 'UPDATE')
              and has_table_privilege($1, c.oid, 'DELETE')
              as app_has_required_privileges,
            c.relowner = (select oid from pg_roles where rolname = $1)
              as app_is_owner
     from pg_class c
     inner join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
     order by c.relname`,
    [appRole],
  );

  const rlsDisabled = tableSecurity.rows
    .filter((table) => !table.rls_enabled)
    .map((table) => table.table_name);
  const exposedTables = tableSecurity.rows
    .filter(
      (table) =>
        table.anon_has_privilege || table.authenticated_has_privilege,
    )
    .map((table) => table.table_name);
  const appPrivilegeFailures = tableSecurity.rows
    .filter((table) => !table.app_has_required_privileges)
    .map((table) => table.table_name);
  const appOwnedTables = tableSecurity.rows
    .filter((table) => table.app_is_owner)
    .map((table) => table.table_name);

  assert(
    rlsDisabled.length === 0,
    `RLS is disabled on public tables: ${rlsDisabled.join(", ")}`,
  );
  assert(
    exposedTables.length === 0,
    `Data API roles still have public table privileges: ${exposedTables.join(", ")}`,
  );
  assert(
    appPrivilegeFailures.length === 0,
    `App role is missing CRUD privileges on: ${appPrivilegeFailures.join(", ")}`,
  );
  assert(
    appOwnedTables.length === 0,
    `App role must not own RLS-protected tables: ${appOwnedTables.join(", ")}`,
  );

  const defaultPrivilegeResult = await client.query<{ grant_count: number }>(
    `select count(*)::integer as grant_count
     from pg_default_acl d
     inner join pg_roles owner_role on owner_role.oid = d.defaclrole
     inner join pg_namespace n on n.oid = d.defaclnamespace
     cross join lateral aclexplode(d.defaclacl) acl
     inner join pg_roles grantee_role on grantee_role.oid = acl.grantee
     where owner_role.rolname = 'postgres'
       and n.nspname = 'public'
       and d.defaclobjtype in ('r', 'S')
       and grantee_role.rolname = any($1::text[])`,
    [[...dataApiRoles]],
  );

  assert(
    defaultPrivilegeResult.rows[0]?.grant_count === 0,
    "Data API roles still have postgres default privileges in public.",
  );

  const unsafePolicyResult = await client.query<{
    table_name: string;
    policy_name: string;
  }>(
    `select c.relname as table_name, p.polname as policy_name
     from pg_policy p
     inner join pg_class c on c.oid = p.polrelid
     inner join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and (
         0 = any(p.polroles)
         or exists (
           select 1
           from unnest(p.polroles) policy_role(role_oid)
           inner join pg_roles r on r.oid = policy_role.role_oid
           where r.rolname = any($1::text[])
         )
       )`,
    [[...dataApiRoles]],
  );

  assert(
    unsafePolicyResult.rows.length === 0,
    `Data API roles have RLS policies: ${unsafePolicyResult.rows
      .map((policy) => `${policy.table_name}.${policy.policy_name}`)
      .join(", ")}`,
  );

  const appPolicyResult = await client.query<{
    table_name: string;
    policy_count: number;
  }>(
    `select c.relname as table_name,
            count(p.oid) filter (
              where p.polname = $1
                and p.polcmd = '*'
                and p.polpermissive
                and pg_get_expr(p.polqual, p.polrelid) = 'true'
                and pg_get_expr(p.polwithcheck, p.polrelid) = 'true'
                and exists (
                  select 1
                  from unnest(p.polroles) policy_role(role_oid)
                  inner join pg_roles r on r.oid = policy_role.role_oid
                  where r.rolname = $2
                )
            )::integer as policy_count
     from pg_class c
     inner join pg_namespace n on n.oid = c.relnamespace
     left join pg_policy p on p.polrelid = c.oid
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
     group by c.relname
     order by c.relname`,
    [applicationPolicyName, appRole],
  );
  const missingAppPolicies = appPolicyResult.rows
    .filter((table) => table.policy_count !== 1)
    .map((table) => table.table_name);

  assert(
    missingAppPolicies.length === 0,
    `App role RLS policy is missing or invalid on: ${missingAppPolicies.join(", ")}`,
  );

  return publicTables;
}

export async function configurePublicSchemaSecurity(
  client: PoolClient,
  appRole: string,
) {
  assert(
    appRole === "tricksight_app",
    "APP_DB_ROLE must be tricksight_app before applying public schema security.",
  );

  const identity = await client.query<{ current_user: string }>(
    "select current_user",
  );

  assert(
    identity.rows[0]?.current_user === "postgres",
    "DATABASE_ADMIN_URL must connect as the postgres role.",
  );

  // DDL locksを長時間待って本番リクエストを詰まらせず、取得できなければ全体をrollbackする。
  await client.query("set local lock_timeout = '5s'");
  await client.query("set local statement_timeout = '30s'");

  const publicTables = await listPublicTables(client);
  assertExpectedTableSet(publicTables);
  const roleIdentifier = await quoteIdentifier(client, appRole);
  const policyIdentifier = await quoteIdentifier(client, applicationPolicyName);

  // Supabaseの既定権限による直接公開を止める第一層。service_roleは意図的に変更しない。
  await client.query(
    "revoke all privileges on all tables in schema public from anon, authenticated",
  );
  await client.query(
    "revoke all privileges on all sequences in schema public from anon, authenticated",
  );
  await client.query(
    `alter default privileges for role postgres in schema public
     revoke all privileges on tables from anon, authenticated`,
  );
  await client.query(
    `alter default privileges for role postgres in schema public
     revoke all privileges on sequences from anon, authenticated`,
  );

  for (const table of publicTables) {
    const tableIdentifier = await quoteIdentifier(client, table);

    await client.query(
      `alter table public.${tableIdentifier} enable row level security`,
    );
    await client.query(
      `drop policy if exists ${policyIdentifier} on public.${tableIdentifier}`,
    );
    // ownerScopeがアプリ内の所有者境界を担う。RLSはData APIロールの再付与や運用ミスを
    // 遮断する第二層であり、専用接続ロールには従来どおり全行DMLを許可する。
    await client.query(
      `create policy ${policyIdentifier}
       on public.${tableIdentifier}
       for all
       to ${roleIdentifier}
       using (true)
       with check (true)`,
    );
    await client.query(
      `comment on policy ${policyIdentifier} on public.${tableIdentifier} is
       'Defense in depth for Supabase Data API exposure. Application ownership is enforced by ownerScope; this policy preserves the dedicated runtime role.'`,
    );
  }

  await verifyPublicSchemaSecurity(client, appRole);
  await verifyAppRoleCrudInsideTransaction(client, appRole, roleIdentifier);

  return publicTables;
}

export async function rollbackPublicSchemaRls(
  client: PoolClient,
  appRole: string,
) {
  assert(
    appRole === "tricksight_app",
    "APP_DB_ROLE must be tricksight_app before rolling back public schema RLS.",
  );

  const identity = await client.query<{ current_user: string }>(
    "select current_user",
  );

  assert(
    identity.rows[0]?.current_user === "postgres",
    "DATABASE_ADMIN_URL must connect as the postgres role.",
  );

  await client.query("set local lock_timeout = '5s'");
  await client.query("set local statement_timeout = '30s'");

  const publicTables = await listPublicTables(client);
  assertExpectedTableSet(publicTables);
  const policyIdentifier = await quoteIdentifier(client, applicationPolicyName);

  for (const table of publicTables) {
    const tableIdentifier = await quoteIdentifier(client, table);

    await client.query(
      `drop policy if exists ${policyIdentifier} on public.${tableIdentifier}`,
    );
    await client.query(
      `alter table public.${tableIdentifier} disable row level security`,
    );
  }

  const rollbackState = await client.query<{
    rls_enabled_count: number;
    policy_count: number;
  }>(
    `select
       (count(distinct c.oid) filter (where c.relrowsecurity))::integer
         as rls_enabled_count,
       (count(distinct p.oid) filter (where p.polname = $1))::integer
         as policy_count
     from pg_class c
     inner join pg_namespace n on n.oid = c.relnamespace
     left join pg_policy p on p.polrelid = c.oid
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')`,
    [applicationPolicyName],
  );

  assert(
    rollbackState.rows[0]?.rls_enabled_count === 0 &&
      rollbackState.rows[0]?.policy_count === 0,
    "RLS recovery did not disable every table and remove every app policy.",
  );

  return publicTables;
}
