import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { tricks } from "@/lib/db/schema";

function requiredEnvironment(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set. Add it to .env.local.`);
  }

  return value;
}

const defaultTricks = [
  {
    slug: "ollie",
    name: "Ollie",
    description: "テールを弾き、ボードと一緒に跳ぶ基本トリック。",
  },
  {
    slug: "pop-shove-it",
    name: "Pop Shove-it",
    description: "ボードを水平方向に180度回転させるトリック。",
  },
  {
    slug: "kickflip",
    name: "Kickflip",
    description: "前足でボードを弾き、縦方向に1回転させるトリック。",
  },
] as const;

async function main() {
  const pool = new Pool({
    connectionString: requiredEnvironment("DATABASE_ADMIN_URL"),
    connectionTimeoutMillis: 10_000,
    max: 1,
  });
  const db = drizzle({ client: pool });

  try {
    await db
      .insert(tricks)
      .values(defaultTricks.map((trick) => ({ ...trick, isActive: true })))
      .onConflictDoUpdate({
        target: tricks.slug,
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          isActive: true,
          updatedAt: new Date(),
        },
      });
    console.log(`Seeded ${defaultTricks.length} tricks.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
});
