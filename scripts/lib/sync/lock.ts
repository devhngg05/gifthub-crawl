import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "@/db";
import { sanitizeErrorMessage } from "@/lib/sanitize-error";
import type { SyncLogger } from "./upsert";

/**
 * Reserved row ID in `sync_logs` used as an atomic distributed lease lock.
 *
 * Why a `sync_logs` lease row instead of `pg_try_advisory_lock`:
 * `@neondatabase/serverless` HTTP driver (`neon()` in `src/db/index.ts`) runs each
 * query over stateless HTTP without holding a persistent PostgreSQL session, so
 * session-level advisory locks (`pg_try_advisory_lock(SYNC_LOCK_ADVISORY_KEY)`)
 * are automatically released right after the HTTP request finishes. Using a
 * single reserved row (`id = -1`) with atomic `INSERT ... ON CONFLICT DO UPDATE`
 * + TTL lease expiration works across stateless Neon HTTP clients, Vercel
 * serverless functions, and GitHub Actions workers without schema changes.
 */
export const SYNC_LOCK_ROW_ID = -1;
export const SYNC_LOCK_ADVISORY_KEY = 748291045;
export const SYNC_LOCK_PREFIX = "__SYNC_LOCK__:";
export const DEFAULT_SYNC_LOCK_TTL_SECONDS = 1500;
export const MIN_SYNC_LOCK_TTL_SECONDS = 30;
export const MAX_SYNC_LOCK_TTL_SECONDS = 7200;

const SyncLockTtlSchema = z.coerce
  .number()
  .int()
  .min(MIN_SYNC_LOCK_TTL_SECONDS)
  .max(MAX_SYNC_LOCK_TTL_SECONDS);

export interface SyncLockHandle {
  marker: string;
  acquiredAt: Date;
  expiresAt: Date;
  release: () => Promise<void>;
}

export interface AcquireSyncLockOptions {
  ttlSeconds?: number;
  now?: () => Date;
  ownerId?: string;
  logger?: Pick<SyncLogger, "info" | "warn">;
}

export type AcquireSyncLockResult =
  | { acquired: true; handle: SyncLockHandle }
  | {
      acquired: false;
      activeHolder: { ranAt: string | null; marker: string | null } | null;
    };

/** Parse and validate `SYNC_LOCK_TTL_SECONDS` (default 1500s, allowed 30..7200s). */
export function parseSyncLockTtlSeconds(rawValue?: string): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    return DEFAULT_SYNC_LOCK_TTL_SECONDS;
  }

  const normalized = rawValue.trim();
  const parsed = SyncLockTtlSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(
      `Invalid SYNC_LOCK_TTL_SECONDS value "${normalized}": expected an integer between ${MIN_SYNC_LOCK_TTL_SECONDS} and ${MAX_SYNC_LOCK_TTL_SECONDS}`,
    );
  }

  return parsed.data;
}

/** Extract row array safely from Drizzle `execute()` output (`{ rows }` or raw array). */
export function extractExecuteRows<T = Record<string, unknown>>(
  result: unknown,
): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

/**
 * Acquire an atomic distributed lease lock on `sync_logs` (`id = -1`) so concurrent
 * scheduled, post-deploy, Vercel Cron, and manual runs never overlap.
 */
export async function acquireSyncLock(
  dbClient: DatabaseClient,
  options: AcquireSyncLockOptions = {},
): Promise<AcquireSyncLockResult> {
  const ttlSeconds = Math.min(
    MAX_SYNC_LOCK_TTL_SECONDS,
    Math.max(
      MIN_SYNC_LOCK_TTL_SECONDS,
      Math.floor(options.ttlSeconds ?? DEFAULT_SYNC_LOCK_TTL_SECONDS),
    ),
  );
  const nowFn = options.now ?? (() => new Date());
  const nowDate = nowFn();
  const expiresAt = new Date(nowDate.getTime() + ttlSeconds * 1000);
  const staleBefore = new Date(nowDate.getTime() - ttlSeconds * 1000);
  const rawOwner = options.ownerId?.trim();
  const ownerId = rawOwner
    ? `${rawOwner}:${randomUUID().slice(0, 8)}`
    : randomUUID();
  const marker = `${SYNC_LOCK_PREFIX}${ownerId}:${expiresAt.toISOString()}`;

  const acquireResult = await dbClient.execute(sql`
    INSERT INTO sync_logs (
      id,
      ran_at,
      fetched_count,
      ai_processed_count,
      updated_stars_only,
      failed_count,
      error_summary
    )
    VALUES (
      ${SYNC_LOCK_ROW_ID},
      ${nowDate.toISOString()}::timestamptz,
      0,
      0,
      0,
      0,
      ${marker}
    )
    ON CONFLICT (id) DO UPDATE
    SET
      ran_at = EXCLUDED.ran_at,
      error_summary = EXCLUDED.error_summary
    WHERE sync_logs.ran_at < ${staleBefore.toISOString()}::timestamptz
    RETURNING id, ran_at, error_summary
  `);

  const acquiredRows = extractExecuteRows<{
    id?: number;
    ran_at?: unknown;
    error_summary?: string | null;
  }>(acquireResult);

  if (acquiredRows.length > 0) {
    let released = false;
    const release = async (): Promise<void> => {
      if (released) {
        return;
      }
      released = true;
      try {
        await dbClient.execute(sql`
          DELETE FROM sync_logs
          WHERE id = ${SYNC_LOCK_ROW_ID}
            AND error_summary = ${marker}
        `);
      } catch (error) {
        options.logger?.warn(
          `[sync-lock] Failed to release distributed lock: ${sanitizeErrorMessage(error)}`,
        );
      }
    };

    return {
      acquired: true,
      handle: {
        marker,
        acquiredAt: nowDate,
        expiresAt,
        release,
      },
    };
  }

  let activeHolder: { ranAt: string | null; marker: string | null } | null =
    null;
  try {
    const holderResult = await dbClient.execute(sql`
      SELECT ran_at, error_summary
      FROM sync_logs
      WHERE id = ${SYNC_LOCK_ROW_ID}
      LIMIT 1
    `);
    const holderRows = extractExecuteRows<{
      ran_at?: unknown;
      error_summary?: string | null;
    }>(holderResult);
    const holder = holderRows[0];
    if (holder) {
      activeHolder = {
        ranAt:
          holder.ran_at instanceof Date
            ? holder.ran_at.toISOString()
            : holder.ran_at != null
              ? String(holder.ran_at)
              : null,
        marker: holder.error_summary ?? null,
      };
    }
  } catch (error) {
    options.logger?.warn(
      `[sync-lock] Unable to inspect active lock holder: ${sanitizeErrorMessage(error)}`,
    );
  }

  return {
    acquired: false,
    activeHolder,
  };
}
