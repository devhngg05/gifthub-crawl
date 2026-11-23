import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "@/db";
import {
  acquireSyncLock,
  DEFAULT_SYNC_LOCK_TTL_SECONDS,
  extractExecuteRows,
  MAX_SYNC_LOCK_TTL_SECONDS,
  MIN_SYNC_LOCK_TTL_SECONDS,
  parseSyncLockTtlSeconds,
  SYNC_LOCK_ADVISORY_KEY,
  SYNC_LOCK_PREFIX,
  SYNC_LOCK_ROW_ID,
} from "../sync/lock";

function compileSql(expr: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(expr);
}

interface LockRowState {
  id: number;
  ran_at: Date;
  error_summary: string;
}

function createInMemoryLockDb(initialRow: LockRowState | null = null) {
  let lockRow: LockRowState | null = initialRow ? { ...initialRow } : null;
  const executedQueries: Array<{ sql: string; params: unknown[] }> = [];

  const dbClient = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = compileSql(query);
      executedQueries.push(compiled);
      const normalized = compiled.sql.replace(/\s+/g, " ").trim();

      if (normalized.startsWith("INSERT INTO sync_logs")) {
        const id = Number(compiled.params[0]);
        const ranAt = new Date(String(compiled.params[1]));
        const marker = String(compiled.params[2]);
        const staleBefore = new Date(String(compiled.params[3]));

        if (!lockRow) {
          lockRow = { id, ran_at: ranAt, error_summary: marker };
          return { rows: [{ ...lockRow }] };
        }

        if (lockRow.ran_at.getTime() < staleBefore.getTime()) {
          lockRow = { id, ran_at: ranAt, error_summary: marker };
          return { rows: [{ ...lockRow }] };
        }

        return { rows: [] };
      }

      if (normalized.startsWith("SELECT ran_at, error_summary FROM sync_logs")) {
        return {
          rows: lockRow
            ? [{ ran_at: lockRow.ran_at, error_summary: lockRow.error_summary }]
            : [],
        };
      }

      if (normalized.startsWith("DELETE FROM sync_logs")) {
        const id = Number(compiled.params[0]);
        const marker = String(compiled.params[1]);
        if (lockRow && lockRow.id === id && lockRow.error_summary === marker) {
          lockRow = null;
          return { rows: [{ id }] };
        }
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };

  return {
    db: dbClient as unknown as DatabaseClient,
    getLockRow: () => lockRow,
    executedQueries,
  };
}

describe("scripts/lib/sync/lock", () => {
  it("validates SYNC_LOCK_TTL_SECONDS with Zod and safe bounds", () => {
    expect(SYNC_LOCK_ROW_ID).toBe(-1);
    expect(SYNC_LOCK_ADVISORY_KEY).toBe(748291045);
    expect(parseSyncLockTtlSeconds(undefined)).toBe(
      DEFAULT_SYNC_LOCK_TTL_SECONDS,
    );
    expect(parseSyncLockTtlSeconds("   ")).toBe(DEFAULT_SYNC_LOCK_TTL_SECONDS);
    expect(parseSyncLockTtlSeconds(String(MIN_SYNC_LOCK_TTL_SECONDS))).toBe(30);
    expect(parseSyncLockTtlSeconds(String(MAX_SYNC_LOCK_TTL_SECONDS))).toBe(
      7200,
    );
    expect(parseSyncLockTtlSeconds(" 180 ")).toBe(180);

    expect(() => parseSyncLockTtlSeconds("29")).toThrow(
      /Invalid SYNC_LOCK_TTL_SECONDS/,
    );
    expect(() => parseSyncLockTtlSeconds("7201")).toThrow(
      /Invalid SYNC_LOCK_TTL_SECONDS/,
    );
    expect(() => parseSyncLockTtlSeconds("abc")).toThrow(
      /Invalid SYNC_LOCK_TTL_SECONDS/,
    );
  });

  it("extracts rows from both array and { rows } Neon/pg result shapes", () => {
    expect(extractExecuteRows([{ id: 1 }])).toEqual([{ id: 1 }]);
    expect(extractExecuteRows({ rows: [{ id: 2 }] })).toEqual([{ id: 2 }]);
    expect(extractExecuteRows(null)).toEqual([]);
    expect(extractExecuteRows({})).toEqual([]);
  });

  it("acquires a fresh lease lock, emits atomic upsert SQL, and releases idempotently", async () => {
    const mock = createInMemoryLockDb(null);
    const fixedNow = new Date("2026-11-23T10:00:00.000Z");

    const result = await acquireSyncLock(mock.db, {
      ttlSeconds: 120,
      now: () => fixedNow,
      ownerId: "vercel-cron",
    });

    expect(result.acquired).toBe(true);
    if (!result.acquired) {
      throw new Error("Expected lock acquisition");
    }

    expect(result.handle.marker.startsWith(`${SYNC_LOCK_PREFIX}vercel-cron:`)).toBe(
      true,
    );
    expect(result.handle.expiresAt.toISOString()).toBe(
      "2026-11-23T10:02:00.000Z",
    );
    expect(mock.getLockRow()).not.toBeNull();
    expect(mock.executedQueries[0]?.sql).toContain("ON CONFLICT (id) DO UPDATE");
    expect(mock.executedQueries[0]?.sql).toContain(
      "WHERE sync_logs.ran_at <",
    );

    // Calling release twice should only trigger DELETE once
    await result.handle.release();
    await result.handle.release();
    expect(mock.getLockRow()).toBeNull();
    const deleteCalls = mock.executedQueries.filter((q) =>
      q.sql.includes("DELETE FROM sync_logs"),
    );
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]?.params).toEqual([
      SYNC_LOCK_ROW_ID,
      result.handle.marker,
    ]);
  });

  it("returns acquired=false with activeHolder when an unexpired lease lock exists", async () => {
    const activeRanAt = new Date("2026-11-23T10:05:00.000Z");
    const mock = createInMemoryLockDb({
      id: SYNC_LOCK_ROW_ID,
      ran_at: activeRanAt,
      error_summary: "__SYNC_LOCK__:gha-worker:2026-11-23T10:30:00.000Z",
    });

    const result = await acquireSyncLock(mock.db, {
      ttlSeconds: 1500,
      now: () => new Date("2026-11-23T10:10:00.000Z"),
    });

    expect(result).toEqual({
      acquired: false,
      activeHolder: {
        ranAt: activeRanAt.toISOString(),
        marker: "__SYNC_LOCK__:gha-worker:2026-11-23T10:30:00.000Z",
      },
    });
    expect(mock.getLockRow()?.error_summary).toBe(
      "__SYNC_LOCK__:gha-worker:2026-11-23T10:30:00.000Z",
    );
  });

  it("takes over expired stale leases and prevents old owners from deleting new locks", async () => {
    const staleRanAt = new Date("2026-11-23T09:00:00.000Z");
    const staleMarker = "__SYNC_LOCK__:crashed-worker:2026-11-23T09:25:00.000Z";
    const mock = createInMemoryLockDb({
      id: SYNC_LOCK_ROW_ID,
      ran_at: staleRanAt,
      error_summary: staleMarker,
    });

    const result = await acquireSyncLock(mock.db, {
      ttlSeconds: 1500,
      now: () => new Date("2026-11-23T10:00:00.000Z"),
      ownerId: "fresh-worker",
    });

    expect(result.acquired).toBe(true);
    if (!result.acquired) {
      throw new Error("Expected stale lock takeover");
    }

    const newMarker = result.handle.marker;
    expect(mock.getLockRow()?.error_summary).toBe(newMarker);

    // Even if a stale worker executes DELETE with its old marker, the new lease stays intact
    await (
      mock.db as unknown as {
        execute: (q: {
          queryChunks: unknown;
        }) => Promise<unknown>;
      }
    ).execute(
      // Simulate stale owner SQL via raw drizzle sql helper
      (await import("drizzle-orm")).sql`
        DELETE FROM sync_logs
        WHERE id = ${SYNC_LOCK_ROW_ID}
          AND error_summary = ${staleMarker}
      `,
    );

    expect(mock.getLockRow()?.error_summary).toBe(newMarker);
  });

  it("swallows and logs sanitized warnings if release DELETE fails", async () => {
    const warn = vi.fn();
    let callIdx = 0;
    const failingDb = {
      execute: vi.fn(async () => {
        callIdx += 1;
        if (callIdx === 1) {
          return { rows: [{ id: -1 }] };
        }
        throw new Error(
          "postgresql://user:secret_pass@ep-cool.neon.tech/neondb connection lost",
        );
      }),
    } as unknown as DatabaseClient;

    const result = await acquireSyncLock(failingDb, {
      logger: { info: vi.fn(), warn },
    });
    expect(result.acquired).toBe(true);
    if (result.acquired) {
      await expect(result.handle.release()).resolves.toBeUndefined();
    }

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("[REDACTED_DATABASE_URL]");
    expect(warn.mock.calls[0]?.[0]).not.toContain("secret_pass");
  });
});
