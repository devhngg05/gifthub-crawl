import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { z } from "zod";
import * as schema from "./schema";

export type DatabaseClient = NeonHttpDatabase<typeof schema>;

const NonEmptyDatabaseUrlSchema = z.string().trim().min(1);

const DatabaseEnvSchema = z.object({
  DATABASE_URL: z.string().optional(),
  DATABASE_URL_UNPOOLED: z.string().optional(),
});

const ALLOWED_PG_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

/**
 * Chuẩn hóa connection string Neon PostgreSQL:
 * validate định dạng PostgreSQL và xóa tham số `channel_binding`
 * (giữ nguyên `sslmode=require` và các tham số khác).
 * Không đưa raw URL vào thông điệp lỗi để tránh lộ credential.
 */
export function sanitizeDatabaseUrl(url: string): string {
  const parsedString = NonEmptyDatabaseUrlSchema.safeParse(url);
  if (!parsedString.success) {
    throw new Error(
      "DATABASE_URL must be a non-empty PostgreSQL connection URL",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(parsedString.data);
  } catch {
    throw new Error("Invalid PostgreSQL connection URL format");
  }

  if (!ALLOWED_PG_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      "Database URL must use postgres:// or postgresql:// protocol",
    );
  }

  if (parsed.hostname.length === 0) {
    throw new Error("Database URL must include a valid hostname");
  }

  for (const key of Array.from(parsed.searchParams.keys())) {
    if (key.toLowerCase() === "channel_binding") {
      parsed.searchParams.delete(key);
    }
  }

  return parsed.toString();
}

export interface DatabaseEnvInput {
  DATABASE_URL?: string | undefined;
  DATABASE_URL_UNPOOLED?: string | undefined;
  [key: string]: string | undefined;
}

/** Lấy và chuẩn hóa `DATABASE_URL` cho ứng dụng và sync worker. */
export function resolveAppDatabaseUrl(
  env: DatabaseEnvInput = process.env,
): string {
  const parsedEnv = DatabaseEnvSchema.parse(env);
  if (!parsedEnv.DATABASE_URL?.trim()) {
    throw new Error("Missing DATABASE_URL environment variable");
  }

  return sanitizeDatabaseUrl(parsedEnv.DATABASE_URL);
}

/**
 * Lấy và chuẩn hóa URL dùng cho Drizzle migration:
 * ưu tiên `DATABASE_URL_UNPOOLED`, fallback sang `DATABASE_URL`.
 */
export function resolveMigrationDatabaseUrl(
  env: DatabaseEnvInput = process.env,
): string {
  const parsedEnv = DatabaseEnvSchema.parse(env);
  const rawUrl =
    parsedEnv.DATABASE_URL_UNPOOLED?.trim() || parsedEnv.DATABASE_URL?.trim();
  if (!rawUrl) {
    throw new Error(
      "Missing DATABASE_URL_UNPOOLED or DATABASE_URL environment variable",
    );
  }

  return sanitizeDatabaseUrl(rawUrl);
}

/** Tạo Drizzle client dùng HTTP driver `neon()` từ connection string đã sanitize. */
export function createDb(rawUrl: string): DatabaseClient {
  const sanitizedUrl = sanitizeDatabaseUrl(rawUrl);
  const client = neon(sanitizedUrl);
  return drizzle({ client, schema });
}

let cachedConnection: { url: string; client: DatabaseClient } | null = null;

/** Trả về Drizzle client dùng chung theo cơ chế lazy singleton, tự làm mới khi URL đổi. */
export function getDb(): DatabaseClient {
  const sanitizedUrl = resolveAppDatabaseUrl();
  if (cachedConnection && cachedConnection.url === sanitizedUrl) {
    return cachedConnection.client;
  }

  const client = createDb(sanitizedUrl);
  cachedConnection = { url: sanitizedUrl, client };
  return client;
}

/** Lazy Proxy cho phép import `db` an toàn trong test/build trước khi có `DATABASE_URL`. */
export const db: DatabaseClient = new Proxy({} as DatabaseClient, {
  get(_target, prop) {
    const instance = getDb();
    const value = Reflect.get(instance, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export { schema };
