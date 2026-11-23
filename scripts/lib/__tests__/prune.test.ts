import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "@/db";
import {
  computePruneDeleteLimit,
  DEFAULT_DB_MAX_TOOLS,
  DEFAULT_DB_MIN_TOOLS_KEEP,
  DEFAULT_DB_PRUNE_BATCH_SIZE,
  DEFAULT_DB_PRUNE_THRESHOLD_MB,
  DEFAULT_SYNC_LOGS_MAX_ROWS,
  getStarFloorThreshold,
  parsePruneConfig,
  pruneDatabase,
  type PruneConfig,
} from "../sync/prune";

function compileSql(expr: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(expr);
}

interface MockToolEntry {
  id: number;
  stars: number;
  isPinned: boolean;
  userNotes: string | null;
  lastPushedAt: Date;
  updatedAt: Date;
}

interface MockSyncLogEntry {
  id: number;
  ranAt: Date;
}

function makeToolEntry(
  id: number,
  overrides: Partial<MockToolEntry> = {},
): MockToolEntry {
  return {
    id,
    stars: 1000 + id,
    isPinned: false,
    userNotes: null,
    lastPushedAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-02T00:00:00Z"),
    ...overrides,
  };
}

function sortByVictimPriority(a: MockToolEntry, b: MockToolEntry): number {
  if (a.stars !== b.stars) {
    return a.stars - b.stars;
  }
  const pushedDiff = a.lastPushedAt.getTime() - b.lastPushedAt.getTime();
  if (pushedDiff !== 0) {
    return pushedDiff;
  }
  const updatedDiff = a.updatedAt.getTime() - b.updatedAt.getTime();
  if (updatedDiff !== 0) {
    return updatedDiff;
  }
  return a.id - b.id;
}

function isEligibleVictim(tool: MockToolEntry): boolean {
  if (tool.isPinned) {
    return false;
  }
  return tool.userNotes === null || tool.userNotes.trim() === "";
}

function createInMemoryPruneDb(options: {
  tools?: MockToolEntry[];
  syncLogs?: MockSyncLogEntry[];
  dbSizeBytes?: number;
  vacuumShouldFail?: boolean;
}) {
  const toolRows = [...(options.tools ?? [])];
  const syncLogRows = [...(options.syncLogs ?? [])];
  const dbSizeBytes = options.dbSizeBytes ?? 100 * 1024 * 1024;
  const executedQueries: Array<{ sql: string; params: unknown[] }> = [];
  let vacuumCallCount = 0;

  const dbClient = {
    execute: vi.fn(async (query: SQL) => {
      const compiled = compileSql(query);
      executedQueries.push(compiled);
      const normalized = compiled.sql.replace(/\s+/g, " ").trim();

      if (normalized.includes("pg_database_size")) {
        return { rows: [{ size_bytes: String(dbSizeBytes) }] };
      }

      if (normalized.includes("COUNT(*)::int AS total_tools FROM tools")) {
        return { rows: [{ total_tools: toolRows.length }] };
      }

      if (normalized.includes("FROM tools ORDER BY stars DESC, id DESC OFFSET")) {
        const offset = Number(compiled.params[0] ?? 0);
        const sorted = [...toolRows].sort((a, b) =>
          b.stars !== a.stars ? b.stars - a.stars : b.id - a.id,
        );
        const row = sorted[offset];
        return { rows: row ? [{ stars: row.stars }] : [] };
      }

      if (normalized.includes("SELECT MAX(stars)::int AS floor_stars")) {
        const limit = Number(compiled.params[0] ?? 0);
        const victims = toolRows
          .filter(isEligibleVictim)
          .sort(sortByVictimPriority)
          .slice(0, limit);
        const floorStars =
          victims.length > 0
            ? Math.max(...victims.map((v) => v.stars))
            : null;
        return { rows: [{ floor_stars: floorStars }] };
      }

      if (normalized.includes("DELETE FROM tools")) {
        const limit = Number(compiled.params[0] ?? 0);
        const victims = toolRows
          .filter(isEligibleVictim)
          .sort(sortByVictimPriority)
          .slice(0, limit);
        const victimIds = new Set(victims.map((v) => v.id));
        for (let i = toolRows.length - 1; i >= 0; i -= 1) {
          if (victimIds.has(toolRows[i].id)) {
            toolRows.splice(i, 1);
          }
        }
        return {
          rows: victims.map((v) => ({ id: v.id, stars: v.stars })),
        };
      }

      if (normalized.startsWith("VACUUM")) {
        vacuumCallCount += 1;
        if (options.vacuumShouldFail) {
          throw new Error("VACUUM cannot run inside a transaction block");
        }
        return { rows: [] };
      }

      if (normalized.includes("DELETE FROM sync_logs")) {
        const offset = Number(compiled.params[0] ?? 0);
        const positiveLogs = syncLogRows
          .filter((l) => l.id > 0)
          .sort((a, b) =>
            b.ranAt.getTime() !== a.ranAt.getTime()
              ? b.ranAt.getTime() - a.ranAt.getTime()
              : b.id - a.id,
          );
        const staleLogs = positiveLogs.slice(offset);
        const staleIds = new Set(staleLogs.map((l) => l.id));
        for (let i = syncLogRows.length - 1; i >= 0; i -= 1) {
          if (staleIds.has(syncLogRows[i].id)) {
            syncLogRows.splice(i, 1);
          }
        }
        return { rows: staleLogs.map((l) => ({ id: l.id })) };
      }

      return { rows: [] };
    }),
  };

  return {
    db: dbClient as unknown as DatabaseClient,
    toolRows,
    syncLogRows,
    executedQueries,
    getVacuumCallCount: () => vacuumCallCount,
  };
}

describe("scripts/lib/sync/prune", () => {
  it("parses prune environment config with Neon Free Tier defaults and strict Zod validation", () => {
    expect(parsePruneConfig({})).toEqual({
      maxTools: DEFAULT_DB_MAX_TOOLS,
      pruneThresholdMb: DEFAULT_DB_PRUNE_THRESHOLD_MB,
      pruneBatchSize: DEFAULT_DB_PRUNE_BATCH_SIZE,
      minToolsKeep: DEFAULT_DB_MIN_TOOLS_KEEP,
      syncLogsMaxRows: DEFAULT_SYNC_LOGS_MAX_ROWS,
    });

    expect(
      parsePruneConfig({
        DB_MAX_TOOLS: " 2500 ",
        DB_PRUNE_THRESHOLD_MB: "320.5",
        DB_PRUNE_BATCH_SIZE: "500",
        DB_MIN_TOOLS_KEEP: "0",
        SYNC_LOGS_MAX_ROWS: "150",
      }),
    ).toEqual({
      maxTools: 2500,
      pruneThresholdMb: 320.5,
      pruneBatchSize: 500,
      minToolsKeep: 0,
      syncLogsMaxRows: 150,
    });

    expect(() => parsePruneConfig({ DB_MAX_TOOLS: "0" })).toThrow(
      /Invalid DB_MAX_TOOLS/,
    );
    expect(() => parsePruneConfig({ DB_PRUNE_THRESHOLD_MB: "-5" })).toThrow(
      /Invalid DB_PRUNE_THRESHOLD_MB/,
    );
    expect(() =>
      parsePruneConfig({ DB_PRUNE_THRESHOLD_MB: "Infinity" }),
    ).toThrow(/Invalid DB_PRUNE_THRESHOLD_MB/);
    expect(() => parsePruneConfig({ DB_PRUNE_BATCH_SIZE: "0" })).toThrow(
      /Invalid DB_PRUNE_BATCH_SIZE/,
    );
    expect(() => parsePruneConfig({ DB_PRUNE_BATCH_SIZE: "501" })).toThrow(
      /Invalid DB_PRUNE_BATCH_SIZE/,
    );
    expect(() => parsePruneConfig({ DB_MIN_TOOLS_KEEP: "-1" })).toThrow(
      /Invalid DB_MIN_TOOLS_KEEP/,
    );
    expect(() => parsePruneConfig({ SYNC_LOGS_MAX_ROWS: "abc" })).toThrow(
      /Invalid SYNC_LOGS_MAX_ROWS/,
    );
  });

  it("computes single-pass delete limit accurately with floor protection", () => {
    const config: PruneConfig = {
      maxTools: 4000,
      pruneThresholdMb: 380,
      pruneBatchSize: 100,
      minToolsKeep: 500,
      syncLogsMaxRows: 300,
    };

    expect(
      computePruneDeleteLimit(
        { dbSizeBytes: 100, dbSizeMb: 200, totalTools: 3000 },
        config,
      ),
    ).toBe(0);

    // Count trigger: 4045 tools -> excess 45 < batch 100
    expect(
      computePruneDeleteLimit(
        { dbSizeBytes: 100, dbSizeMb: 250, totalTools: 4045 },
        config,
      ),
    ).toBe(45);

    // Count trigger capped at pruneBatchSize
    expect(
      computePruneDeleteLimit(
        { dbSizeBytes: 100, dbSizeMb: 250, totalTools: 4300 },
        config,
      ),
    ).toBe(100);

    // Size trigger capped at floorAllowance when totalTools near minToolsKeep
    expect(
      computePruneDeleteLimit(
        { dbSizeBytes: 100, dbSizeMb: 420, totalTools: 530 },
        config,
      ),
    ).toBe(30);

    // Hard floor prevents any delete when totalTools <= minToolsKeep
    expect(
      computePruneDeleteLimit(
        { dbSizeBytes: 100, dbSizeMb: 420, totalTools: 500 },
        config,
      ),
    ).toBe(0);
  });

  it("deletes lowest-star oldest repos first while strictly protecting isPinned and non-empty userNotes", async () => {
    const toolsList: MockToolEntry[] = [
      // Protected despite very low stars:
      makeToolEntry(1, { stars: 10, isPinned: true }),
      makeToolEntry(2, { stars: 20, userNotes: "Dùng hàng ngày" }),
      makeToolEntry(3, { stars: 25, userNotes: "  giữ lại  " }),
      // Eligible victims (including NULL, "", "   " userNotes):
      makeToolEntry(4, {
        stars: 300,
        userNotes: "   ",
        lastPushedAt: new Date("2026-01-01T00:00:00Z"),
      }),
      makeToolEntry(5, {
        stars: 300,
        userNotes: "",
        lastPushedAt: new Date("2026-05-01T00:00:00Z"),
      }),
      makeToolEntry(6, {
        stars: 150,
        userNotes: null,
        lastPushedAt: new Date("2026-06-01T00:00:00Z"),
      }),
      makeToolEntry(7, { stars: 900, userNotes: null }),
      makeToolEntry(8, { stars: 1500, userNotes: null }),
    ];

    const mock = createInMemoryPruneDb({
      tools: toolsList,
      dbSizeBytes: 200 * 1024 * 1024,
    });

    const summary = await pruneDatabase(mock.db, {
      config: {
        maxTools: 6,
        pruneThresholdMb: 380,
        pruneBatchSize: 100,
        minToolsKeep: 4,
        syncLogsMaxRows: 300,
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    // Excess = 8 - 6 = 2 -> deletes id 6 (150 stars) and id 4 (300 stars, older push than id 5)
    expect(summary.prunedToolsCount).toBe(2);
    expect(summary.prunedMaxStars).toBe(300);
    expect(summary.totalToolsBefore).toBe(8);
    expect(summary.totalToolsAfter).toBe(6);
    expect(summary.vacuumRan).toBe(true);
    expect(mock.getVacuumCallCount()).toBe(1);

    const remainingIds = mock.toolRows.map((t) => t.id).sort((a, b) => a - b);
    expect(remainingIds).toEqual([1, 2, 3, 5, 7, 8]);

    // Verify SQL clauses explicitly guard user data and order properly
    const deleteQuery = mock.executedQueries.find((q) =>
      q.sql.includes("DELETE FROM tools"),
    );
    expect(deleteQuery?.sql).toContain("is_pinned = false");
    expect(deleteQuery?.sql).toContain(
      "(user_notes IS NULL OR btrim(user_notes) = '')",
    );
    expect(deleteQuery?.sql).toContain(
      "ORDER BY stars ASC, last_pushed_at ASC, updated_at ASC, id ASC",
    );
  });

  it("enforces DB_MIN_TOOLS_KEEP and runs only ONE bounded DB_PRUNE_BATCH_SIZE pass even if pg_database_size stays high", async () => {
    const toolsList = Array.from({ length: 12 }, (_, idx) =>
      makeToolEntry(idx + 1, { stars: (idx + 1) * 100 }),
    );
    const mock = createInMemoryPruneDb({
      tools: toolsList,
      dbSizeBytes: 450 * 1024 * 1024, // 450MB > 380MB threshold, never shrinks in mock
    });

    // Batch 3, minKeep 10 -> can only delete 2 (12 -> 10) even though size > threshold and batch=3
    const summary = await pruneDatabase(mock.db, {
      config: {
        maxTools: 4000,
        pruneThresholdMb: 380,
        pruneBatchSize: 3,
        minToolsKeep: 10,
        syncLogsMaxRows: 300,
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(summary.prunedToolsCount).toBe(2);
    expect(summary.totalToolsAfter).toBe(10);
    expect(
      mock.executedQueries.filter((q) => q.sql.includes("DELETE FROM tools")),
    ).toHaveLength(1);

    // Run again at minToolsKeep=10 -> must delete 0
    const secondRun = await pruneDatabase(mock.db, {
      config: {
        maxTools: 4000,
        pruneThresholdMb: 380,
        pruneBatchSize: 3,
        minToolsKeep: 10,
        syncLogsMaxRows: 300,
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    expect(secondRun.prunedToolsCount).toBe(0);
    expect(secondRun.totalToolsAfter).toBe(10);
  });

  it("prunes stale sync_logs past SYNC_LOGS_MAX_ROWS while preserving lease lock row id=-1 and tolerating VACUUM failures", async () => {
    const toolsList = Array.from({ length: 6 }, (_, idx) =>
      makeToolEntry(idx + 1, { stars: 100 + idx * 50 }),
    );
    const logsList: MockSyncLogEntry[] = [
      { id: -1, ranAt: new Date("2026-11-23T12:00:00Z") },
      { id: 1, ranAt: new Date("2026-11-20T01:00:00Z") },
      { id: 2, ranAt: new Date("2026-11-21T01:00:00Z") },
      { id: 3, ranAt: new Date("2026-11-22T01:00:00Z") },
      { id: 4, ranAt: new Date("2026-11-23T01:00:00Z") },
      { id: 5, ranAt: new Date("2026-11-23T05:00:00Z") },
    ];

    const mock = createInMemoryPruneDb({
      tools: toolsList,
      syncLogs: logsList,
      dbSizeBytes: 400 * 1024 * 1024,
      vacuumShouldFail: true,
    });
    const warn = vi.fn();

    const summary = await pruneDatabase(mock.db, {
      config: {
        maxTools: 10,
        pruneThresholdMb: 380,
        pruneBatchSize: 2,
        minToolsKeep: 2,
        syncLogsMaxRows: 2,
      },
      logger: { info: vi.fn(), warn },
    });

    expect(summary.prunedToolsCount).toBe(2);
    expect(summary.vacuumRan).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("VACUUM (ANALYZE) tools skipped");
    expect(summary.prunedSyncLogsCount).toBe(3);

    // Lease row (-1) + newest 2 positive rows (5, 4) survive
    expect(mock.syncLogRows.map((l) => l.id).sort((a, b) => a - b)).toEqual([
      -1, 4, 5,
    ]);
  });

  it("computes star floor threshold only when DB is near capacity", async () => {
    const toolsList = [
      makeToolEntry(1, { stars: 400 }),
      makeToolEntry(2, { stars: 750 }),
      makeToolEntry(3, { stars: 2000 }),
      makeToolEntry(4, { stars: 5000 }),
    ];

    const healthyMock = createInMemoryPruneDb({
      tools: toolsList,
      dbSizeBytes: 150 * 1024 * 1024,
    });
    const healthyFloor = await getStarFloorThreshold(healthyMock.db, {
      maxTools: 10,
      pruneThresholdMb: 380,
      pruneBatchSize: 2,
      minToolsKeep: 1,
      syncLogsMaxRows: 300,
    });
    expect(healthyFloor.isNearCapacity).toBe(false);
    expect(healthyFloor.minEligibleStars).toBeNull();

    const fullByCountMock = createInMemoryPruneDb({
      tools: toolsList,
      dbSizeBytes: 150 * 1024 * 1024,
    });
    const fullByCountFloor = await getStarFloorThreshold(fullByCountMock.db, {
      maxTools: 4,
      pruneThresholdMb: 380,
      pruneBatchSize: 2,
      minToolsKeep: 1,
      syncLogsMaxRows: 300,
    });
    expect(fullByCountFloor.isNearCapacity).toBe(true);
    // Max of top-4 cutoff (400) and victim preview batch of 2 (400, 750 -> 750) = 750
    expect(fullByCountFloor.minEligibleStars).toBe(750);
  });
});
