import { sql } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "@/db";
import { sanitizeErrorMessage } from "@/lib/sanitize-error";
import { extractExecuteRows } from "./lock";
import type { SyncLogger } from "./upsert";

export const DEFAULT_DB_MAX_TOOLS = 4000;
export const DEFAULT_DB_PRUNE_THRESHOLD_MB = 380;
export const DEFAULT_DB_PRUNE_BATCH_SIZE = 100;
export const MIN_DB_PRUNE_BATCH_SIZE = 1;
export const MAX_DB_PRUNE_BATCH_SIZE = 500;
export const DEFAULT_DB_MIN_TOOLS_KEEP = 500;
export const DEFAULT_SYNC_LOGS_MAX_ROWS = 300;

const BYTES_PER_MB = 1024 * 1024;

export interface PruneConfig {
  maxTools: number;
  pruneThresholdMb: number;
  pruneBatchSize: number;
  minToolsKeep: number;
  syncLogsMaxRows: number;
}

export interface DbCapacityMetrics {
  dbSizeBytes: number;
  dbSizeMb: number;
  totalTools: number;
}

export interface StarFloorResult extends DbCapacityMetrics {
  isNearCapacity: boolean;
  minEligibleStars: number | null;
}

export interface PruneDatabaseSummary {
  dbSizeBytes: number;
  dbSizeMb: number;
  totalToolsBefore: number;
  totalToolsAfter: number;
  prunedToolsCount: number;
  prunedMaxStars: number | null;
  prunedSyncLogsCount: number;
  vacuumRan: boolean;
  config: PruneConfig;
}

export interface PruneDatabaseOptions {
  env?: Record<string, string | undefined>;
  config?: PruneConfig;
  logger?: Pick<SyncLogger, "info" | "warn">;
}

const DbMaxToolsSchema = z.coerce.number().int().positive();
const DbPruneThresholdMbSchema = z.coerce.number().finite().positive();
const DbPruneBatchSizeSchema = z.coerce
  .number()
  .int()
  .min(MIN_DB_PRUNE_BATCH_SIZE)
  .max(MAX_DB_PRUNE_BATCH_SIZE);
const DbMinToolsKeepSchema = z.coerce.number().int().nonnegative();
const SyncLogsMaxRowsSchema = z.coerce.number().int().nonnegative();

function parsePositiveIntConfig(
  rawValue: string | undefined,
  defaultValue: number,
  schema: z.ZodType<number>,
  envName: string,
  expectedMessage: string,
): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    return defaultValue;
  }

  const normalized = rawValue.trim();
  const parsed = schema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(
      `Invalid ${envName} value "${normalized}": ${expectedMessage}`,
    );
  }

  return parsed.data;
}

/** Đọc và kiểm tra các biến môi trường giám sát dung lượng & cắt tỉa DB bằng Zod. */
export function parsePruneConfig(
  env: Record<string, string | undefined> = process.env,
): PruneConfig {
  return {
    maxTools: parsePositiveIntConfig(
      env.DB_MAX_TOOLS,
      DEFAULT_DB_MAX_TOOLS,
      DbMaxToolsSchema,
      "DB_MAX_TOOLS",
      "expected a positive integer",
    ),
    pruneThresholdMb: parsePositiveIntConfig(
      env.DB_PRUNE_THRESHOLD_MB,
      DEFAULT_DB_PRUNE_THRESHOLD_MB,
      DbPruneThresholdMbSchema,
      "DB_PRUNE_THRESHOLD_MB",
      "expected a positive finite number",
    ),
    pruneBatchSize: parsePositiveIntConfig(
      env.DB_PRUNE_BATCH_SIZE,
      DEFAULT_DB_PRUNE_BATCH_SIZE,
      DbPruneBatchSizeSchema,
      "DB_PRUNE_BATCH_SIZE",
      `expected an integer between ${MIN_DB_PRUNE_BATCH_SIZE} and ${MAX_DB_PRUNE_BATCH_SIZE}`,
    ),
    minToolsKeep: parsePositiveIntConfig(
      env.DB_MIN_TOOLS_KEEP,
      DEFAULT_DB_MIN_TOOLS_KEEP,
      DbMinToolsKeepSchema,
      "DB_MIN_TOOLS_KEEP",
      "expected a non-negative integer",
    ),
    syncLogsMaxRows: parsePositiveIntConfig(
      env.SYNC_LOGS_MAX_ROWS,
      DEFAULT_SYNC_LOGS_MAX_ROWS,
      SyncLogsMaxRowsSchema,
      "SYNC_LOGS_MAX_ROWS",
      "expected a non-negative integer",
    ),
  };
}

function toSafeNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Đo dung lượng database hiện tại (`pg_database_size`) và tổng số công cụ trong `tools`. */
export async function getDbCapacityMetrics(
  dbClient: DatabaseClient,
): Promise<DbCapacityMetrics> {
  const [sizeResult, countResult] = await Promise.all([
    dbClient.execute(sql`
      SELECT pg_database_size(current_database())::bigint AS size_bytes
    `),
    dbClient.execute(sql`
      SELECT COUNT(*)::int AS total_tools FROM tools
    `),
  ]);

  const sizeRows = extractExecuteRows<{ size_bytes?: unknown }>(sizeResult);
  const countRows = extractExecuteRows<{ total_tools?: unknown }>(countResult);

  const dbSizeBytes = Math.max(0, toSafeNumber(sizeRows[0]?.size_bytes));
  const dbSizeMb = Number((dbSizeBytes / BYTES_PER_MB).toFixed(2));
  const totalTools = Math.max(0, Math.floor(toSafeNumber(countRows[0]?.total_tools)));

  return {
    dbSizeBytes,
    dbSizeMb,
    totalTools,
  };
}

/**
 * Tính số bản ghi `tools` tối đa được phép xóa trong đúng 1 lượt cắt tỉa:
 * - Tôn trọng ngưỡng sàn `minToolsKeep`.
 * - Không vượt quá `pruneBatchSize` (tuyệt đối không lặp `while (dbSize > threshold)`).
 */
export function computePruneDeleteLimit(
  metrics: DbCapacityMetrics,
  config: PruneConfig,
): number {
  if (
    metrics.totalTools <= config.maxTools &&
    metrics.dbSizeMb < config.pruneThresholdMb
  ) {
    return 0;
  }

  const floorAllowance = Math.max(0, metrics.totalTools - config.minToolsKeep);
  if (floorAllowance === 0) {
    return 0;
  }

  if (metrics.dbSizeMb >= config.pruneThresholdMb) {
    return Math.min(config.pruneBatchSize, floorAllowance);
  }

  const excessCount = Math.max(0, metrics.totalTools - config.maxTools);
  return Math.min(excessCount, config.pruneBatchSize, floorAllowance);
}

/**
 * Kiểm tra trạng thái đầy DB đầu phiên sync để suy ra ngưỡng sao sàn (`minEligibleStars`).
 * Khi DB chạm `DB_PRUNE_THRESHOLD_MB` hoặc `>= DB_MAX_TOOLS`, repo mới có `stars <= minEligibleStars`
 * sẽ được bỏ qua để tránh tốn quota AI cào các repo sắp bị cắt tỉa.
 */
export async function getStarFloorThreshold(
  dbClient: DatabaseClient,
  config: PruneConfig,
  logger?: Pick<SyncLogger, "info" | "warn">,
): Promise<StarFloorResult> {
  const metrics = await getDbCapacityMetrics(dbClient);
  const isNearCapacity =
    metrics.dbSizeMb >= config.pruneThresholdMb ||
    metrics.totalTools >= config.maxTools;

  if (!isNearCapacity) {
    return {
      ...metrics,
      isNearCapacity: false,
      minEligibleStars: null,
    };
  }

  const floorCandidates: number[] = [];

  if (metrics.totalTools >= config.maxTools) {
    const topThresholdResult = await dbClient.execute(sql`
      SELECT stars
      FROM tools
      ORDER BY stars DESC, id DESC
      OFFSET ${Math.max(0, config.maxTools - 1)}
      LIMIT 1
    `);
    const topRows = extractExecuteRows<{ stars?: unknown }>(topThresholdResult);
    if (topRows.length > 0 && topRows[0]?.stars != null) {
      floorCandidates.push(toSafeNumber(topRows[0].stars));
    }
  }

  const floorAllowance = Math.max(0, metrics.totalTools - config.minToolsKeep);
  const victimPreviewLimit = Math.min(config.pruneBatchSize, floorAllowance);
  if (victimPreviewLimit > 0) {
    const victimFloorResult = await dbClient.execute(sql`
      SELECT MAX(stars)::int AS floor_stars
      FROM (
        SELECT stars
        FROM tools
        WHERE is_pinned = false
          AND (user_notes IS NULL OR btrim(user_notes) = '')
        ORDER BY stars ASC, last_pushed_at ASC, updated_at ASC, id ASC
        LIMIT ${victimPreviewLimit}
      ) AS victims
    `);
    const victimRows = extractExecuteRows<{ floor_stars?: unknown }>(
      victimFloorResult,
    );
    if (victimRows.length > 0 && victimRows[0]?.floor_stars != null) {
      floorCandidates.push(toSafeNumber(victimRows[0].floor_stars));
    }
  }

  const minEligibleStars =
    floorCandidates.length > 0 ? Math.max(...floorCandidates) : null;

  logger?.info(
    `[db-prune] DB đang gần ngưỡng tải (${metrics.dbSizeMb} MB / ${config.pruneThresholdMb} MB, ${metrics.totalTools} / ${config.maxTools} tools)${minEligibleStars !== null ? ` -> bỏ qua repo mới có <= ${minEligibleStars} sao` : ""}.`,
  );

  return {
    ...metrics,
    isNearCapacity: true,
    minEligibleStars,
  };
}

/**
 * Giám sát dung lượng DB và thực hiện 1 lượt cắt tỉa an toàn duy nhất:
 * - Bảo vệ tuyệt đối repo `is_pinned = true` hoặc có `user_notes` không rỗng.
 * - Xóa theo thứ tự `stars ASC, last_pushed_at ASC, updated_at ASC, id ASC`, tôn trọng `DB_MIN_TOOLS_KEEP` & `DB_PRUNE_BATCH_SIZE`.
 * - Chạy best-effort `VACUUM (ANALYZE) tools` nếu có xóa bản ghi.
 * - Dọn các dòng `sync_logs` cũ vượt quá `SYNC_LOGS_MAX_ROWS` (giữ nguyên lease lock row `id = -1`).
 */
export async function pruneDatabase(
  dbClient: DatabaseClient,
  options: PruneDatabaseOptions = {},
): Promise<PruneDatabaseSummary> {
  const config = options.config ?? parsePruneConfig(options.env);
  const metrics = await getDbCapacityMetrics(dbClient);
  const deleteLimit = computePruneDeleteLimit(metrics, config);

  let prunedToolsCount = 0;
  let prunedMaxStars: number | null = null;
  let vacuumRan = false;

  if (deleteLimit > 0) {
    const deleteResult = await dbClient.execute(sql`
      WITH victims AS (
        SELECT id, stars
        FROM tools
        WHERE is_pinned = false
          AND (user_notes IS NULL OR btrim(user_notes) = '')
        ORDER BY stars ASC, last_pushed_at ASC, updated_at ASC, id ASC
        LIMIT ${deleteLimit}
      ),
      deleted AS (
        DELETE FROM tools
        WHERE id IN (SELECT id FROM victims)
        RETURNING id, stars
      )
      SELECT id, stars FROM deleted
    `);

    const deletedRows = extractExecuteRows<{ id?: unknown; stars?: unknown }>(
      deleteResult,
    );
    prunedToolsCount = deletedRows.length;

    if (prunedToolsCount > 0) {
      prunedMaxStars = Math.max(
        ...deletedRows.map((row) => toSafeNumber(row.stars)),
      );

      try {
        await dbClient.execute(sql`VACUUM (ANALYZE) tools`);
        vacuumRan = true;
      } catch (vacuumError) {
        options.logger?.warn(
          `[db-prune] VACUUM (ANALYZE) tools skipped (best-effort): ${sanitizeErrorMessage(vacuumError)}`,
        );
      }
    }
  }

  const pruneLogsResult = await dbClient.execute(sql`
    WITH stale_logs AS (
      SELECT id
      FROM sync_logs
      WHERE id > 0
      ORDER BY ran_at DESC, id DESC
      OFFSET ${config.syncLogsMaxRows}
    ),
    deleted_logs AS (
      DELETE FROM sync_logs
      WHERE id IN (SELECT id FROM stale_logs)
      RETURNING id
    )
    SELECT id FROM deleted_logs
  `);

  const prunedSyncLogsCount = extractExecuteRows<{ id?: unknown }>(
    pruneLogsResult,
  ).length;
  const totalToolsAfter = Math.max(0, metrics.totalTools - prunedToolsCount);

  options.logger?.info(
    `[db-prune] DB size=${metrics.dbSizeMb}MB (threshold=${config.pruneThresholdMb}MB), tools=${metrics.totalTools} -> ${totalToolsAfter} (max=${config.maxTools}, minKeep=${config.minToolsKeep}), prunedTools=${prunedToolsCount}, prunedMaxStars=${prunedMaxStars ?? "none"}, prunedSyncLogs=${prunedSyncLogsCount}, vacuum=${vacuumRan}`,
  );

  return {
    dbSizeBytes: metrics.dbSizeBytes,
    dbSizeMb: metrics.dbSizeMb,
    totalToolsBefore: metrics.totalTools,
    totalToolsAfter,
    prunedToolsCount,
    prunedMaxStars,
    prunedSyncLogsCount,
    vacuumRan,
    config,
  };
}
