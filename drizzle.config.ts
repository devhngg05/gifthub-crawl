import { config as loadDotenv } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { sanitizeDatabaseUrl } from "./src/db/index";

loadDotenv({ path: [".env.local", ".env"], quiet: true });

const rawMigrationUrl =
  process.env.DATABASE_URL_UNPOOLED?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  migrations: {
    table: "__drizzle_migrations",
    schema: "drizzle",
  },
  dbCredentials: {
    url: rawMigrationUrl ? sanitizeDatabaseUrl(rawMigrationUrl) : "",
  },
});
