import { defineConfig } from "drizzle-kit";

const adminDatabaseUrl = process.env.DATABASE_ADMIN_URL;

if (!adminDatabaseUrl) {
  throw new Error("DATABASE_ADMIN_URL is not set. Add it to .env.local.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema/*.ts",
  out: "./drizzle",
  dbCredentials: { url: adminDatabaseUrl },
  migrations: {
    schema: "drizzle",
    table: "__drizzle_migrations",
  },
  strict: true,
  verbose: true,
});
