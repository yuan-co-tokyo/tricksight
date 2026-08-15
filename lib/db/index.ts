import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

function databaseUrl() {
  const value = process.env.DATABASE_URL;

  if (!value) {
    throw new Error("DATABASE_URL is not set. Add it to .env.local.");
  }

  return value;
}

const globalDatabase = globalThis as typeof globalThis & {
  tricksightPool?: Pool;
};

export const pool =
  globalDatabase.tricksightPool ??
  new Pool({
    connectionString: databaseUrl(),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    max: 1,
  });

if (process.env.NODE_ENV !== "production") {
  globalDatabase.tricksightPool = pool;
}

export const db = drizzle({ client: pool, schema });
