import "./load-env";

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { db, type DatabaseClient } from "@/db";
import { sanitizeErrorMessage } from "@/lib/sanitize-error";
import { classifyRepo, classifyRepoBatch } from "./lib/classifier";
import {
  fetchCandidateRepos,
  fetchCleanReadme,
  fetchRepoMetadata,
  type GitHubRepoItem,
} from "./lib/github";
import {
  runReclassifySync,
  type SyncReclassifyMode,
} from "./lib/sync/reclassify";
import {
  formatClassificationTable,
  loadExistingToolsMap,
  MAX_ERROR_SUMMARY_LENGTH,
  recordSyncLog,
  updateStarsAndMetadataOnly,
  upsertClassifiedTool,
  type ClassifiedRepoSummary,
  type SyncLogger,
  type SyncRunSummary,
} from "./lib/sync/upsert";

export * from "./lib/sync/upsert";
export * from "./lib/sync/reclassify";
export { sanitizeErrorMessage };

export const DEFAULT_SYNC_LIMIT = 20;
export const DEFAULT_SYNC_BATCH_SIZE = 5;
export const MAX_SYNC_BATCH_SIZE = 20;
export const AI_RATE_LIMIT_DELAY_MS = 4000;

export interface RunSyncOptions {
  db?: DatabaseClient;
  fetchCandidateRepos?: typeof fetchCandidateRepos;
  fetchCleanReadme?: typeof fetchCleanReadme;
  fetchRepoMetadata?: typeof fetchRepoMetadata;
  classifyRepo?: typeof classifyRepo;
  classifyRepoBatch?: typeof classifyRepoBatch;
  sleep?: (ms: number) => Promise<void>;
  env?: Record<string, string | undefined>;
  delayMs?: number;
  now?: () => Date;
  logger?: SyncLogger;
}

const SyncLimitSchema = z.coerce.number().int().positive();
const SyncBatchSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_SYNC_BATCH_SIZE);
const SyncDelaySchema = z.coerce.number().int().nonnegative();

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Đọc và kiểm tra `SYNC_LIMIT` từ env (mặc định 20 khi trống hoặc chưa khai báo). */
export function parseSyncLimit(rawValue?: string): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    return DEFAULT_SYNC_LIMIT;
  }

  const normalized = rawValue.trim();
  const parsed = SyncLimitSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(
      `Invalid SYNC_LIMIT value "${normalized}": expected a positive integer`,
    );
  }

  return parsed.data;
}

/** Đọc và kiểm tra `SYNC_BATCH_SIZE` từ env (mặc định 5, hợp lệ 1..20). */
export function parseSyncBatchSize(rawValue?: string): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    return DEFAULT_SYNC_BATCH_SIZE;
  }

  const normalized = rawValue.trim();
  const parsed = SyncBatchSizeSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(
      `Invalid SYNC_BATCH_SIZE value "${normalized}": expected an integer between 1 and ${MAX_SYNC_BATCH_SIZE}`,
    );
  }

  return parsed.data;
}

/** Đọc và kiểm tra `SYNC_RECLASSIFY` (`none` mặc định | `uncategorized` | `all`). */
export function parseSyncReclassifyMode(rawValue?: string): SyncReclassifyMode {
  if (rawValue === undefined || rawValue.trim() === "") {
    return "none";
  }

  const normalized = rawValue.trim().toLowerCase();
  if (
    normalized === "none" ||
    normalized === "uncategorized" ||
    normalized === "all"
  ) {
    return normalized;
  }

  throw new Error(
    `Invalid SYNC_RECLASSIFY value "${rawValue.trim()}": expected "none", "uncategorized", or "all"`,
  );
}

/** Đọc và kiểm tra `SYNC_DELAY_MS` từ env (mặc định 4000ms khi trống hoặc chưa khai báo). */
export function parseSyncDelayMs(rawValue?: string): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    return AI_RATE_LIMIT_DELAY_MS;
  }

  const normalized = rawValue.trim();
  const parsed = SyncDelaySchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(
      `Invalid SYNC_DELAY_MS value "${normalized}": expected a non-negative integer`,
    );
  }

  return parsed.data;
}

/** Kiểm tra file có đang được chạy trực tiếp qua CLI hay chỉ được import làm module. */
export function isDirectExecution(
  argv1: string | undefined,
  moduleUrl: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!argv1 || argv1.trim().length === 0) {
    return false;
  }

  try {
    const entryHref = pathToFileURL(path.resolve(argv1)).href;
    const moduleHref = pathToFileURL(
      path.resolve(fileURLToPath(moduleUrl)),
    ).href;

    if (platform === "win32") {
      return entryHref.toLowerCase() === moduleHref.toLowerCase();
    }
    return entryHref === moduleHref;
  } catch {
    return false;
  }
}

/** Thực thi một lượt đồng bộ dữ liệu GitHub → AI Fallback → Neon PostgreSQL (hỗ trợ cả `SYNC_RECLASSIFY`). */
export async function runSync(
  options: RunSyncOptions = {},
): Promise<SyncRunSummary> {
  const dbClient = options.db ?? db;
  const fetchCandidatesImpl =
    options.fetchCandidateRepos ?? fetchCandidateRepos;
  const fetchCleanReadmeImpl = options.fetchCleanReadme ?? fetchCleanReadme;
  const fetchRepoMetadataImpl = options.fetchRepoMetadata ?? fetchRepoMetadata;
  const classifyRepoImpl = options.classifyRepo ?? classifyRepo;
  const classifyRepoBatchImpl =
    options.classifyRepoBatch ?? classifyRepoBatch;
  const sleepImpl = options.sleep ?? defaultSleep;
  const env = options.env ?? process.env;
  const delayMs = options.delayMs ?? parseSyncDelayMs(env.SYNC_DELAY_MS);
  const now = options.now ?? (() => new Date());
  const logger: SyncLogger = options.logger ?? {
    info: (message) => console.log(message),
    warn: (message) => console.warn(message),
    error: (message) => console.error(message),
  };

  const syncLimit = parseSyncLimit(env.SYNC_LIMIT);
  const syncBatchSize = parseSyncBatchSize(env.SYNC_BATCH_SIZE);
  const reclassifyMode = parseSyncReclassifyMode(env.SYNC_RECLASSIFY);

  if (reclassifyMode !== "none") {
    return runReclassifySync({
      mode: reclassifyMode,
      dbClient,
      fetchCleanReadmeImpl,
      fetchRepoMetadataImpl,
      classifyRepoBatchImpl,
      sleepImpl,
      delayMs,
      syncLimit,
      syncBatchSize,
      now,
      logger,
    });
  }

  let candidates: GitHubRepoItem[];
  try {
    candidates = await fetchCandidatesImpl({ env });
  } catch (error) {
    const summary = sanitizeErrorMessage(error).slice(
      0,
      MAX_ERROR_SUMMARY_LENGTH,
    );
    try {
      await recordSyncLog(dbClient, {
        fetchedCount: 0,
        aiProcessedCount: 0,
        updatedStarsOnly: 0,
        failedCount: 0,
        errorSummary: summary,
      });
    } catch (logInsertError) {
      logger.error(
        `[sync-tools] Failed to record sync_logs error: ${sanitizeErrorMessage(logInsertError)}`,
      );
    }
    logger.error(`[sync-tools] Failed to fetch GitHub candidates: ${summary}`);
    throw error;
  }

  const fetchedCount = candidates.length;
  logger.info(
    `[sync-tools] Đã tìm thấy ${fetchedCount} ứng viên, đang đối chiếu DB...`,
  );
  const existingMap = await loadExistingToolsMap(dbClient, candidates);

  let aiAttemptedCount = 0;
  let aiProcessedCount = 0;
  let updatedStarsOnly = 0;
  let failedCount = 0;
  const errors: string[] = [];
  const classified: ClassifiedRepoSummary[] = [];
  const providerCooldowns = new Map<string, number>();

  for (const repo of candidates) {
    try {
      const existing = existingMap.get(repo.id);

      // Repo mới nhưng đã chạm SYNC_LIMIT: dừng vòng lặp sớm cho sạch log và tiết kiệm quota.
      if (!existing && aiAttemptedCount >= syncLimit) {
        logger.info(
          `[sync-tools] Reached SYNC_LIMIT (${syncLimit}) at new repo ${repo.full_name}; stopping loop early.`,
        );
        break;
      }

      // Repo đã tồn tại và đã chạm SYNC_LIMIT: chỉ cập nhật stars/lastPushedAt mà không tốn request README/AI,
      // giữ nguyên readmeSha cũ để lượt sau tự động phân loại lại nếu có thay đổi.
      if (existing !== undefined && aiAttemptedCount >= syncLimit) {
        await updateStarsAndMetadataOnly(dbClient, repo, now());
        updatedStarsOnly += 1;
        continue;
      }

      const readme = await fetchCleanReadmeImpl(repo.full_name);

      // Idempotency theo readmeSha: không đổi thì chỉ cập nhật stars/lastPushedAt/updatedAt.
      if (existing !== undefined && existing.readmeSha === readme.sha) {
        await updateStarsAndMetadataOnly(dbClient, repo, now());
        updatedStarsOnly += 1;
        continue;
      }

      aiAttemptedCount += 1;
      if ((aiAttemptedCount - 1) % syncBatchSize === 0) {
        const batchNumber =
          Math.floor((aiAttemptedCount - 1) / syncBatchSize) + 1;
        const batchSize = Math.min(
          syncBatchSize,
          syncLimit - (batchNumber - 1) * syncBatchSize,
        );
        logger.info(
          `[sync-tools] Đang tải README & phân loại lô ${batchNumber} (${batchSize} repo)...`,
        );
      }

      const { classification, provider } = await classifyRepoImpl(
        {
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description ?? "",
          homepage: repo.homepage ?? null,
          language: repo.language,
          topics: repo.topics,
          readmeText: readme.text,
        },
        {
          providerCooldowns,
          sleep: sleepImpl,
          now: () => now().getTime(),
        },
      );

      await upsertClassifiedTool(
        dbClient,
        repo,
        readme.sha,
        classification,
        now(),
        existing?.userNotes ?? null,
      );

      aiProcessedCount += 1;
      classified.push({
        fullName: repo.full_name,
        provider,
        subCategory: classification.sub_category,
        usability: classification.usability,
      });

      logger.info(
        `[sync-tools] [${aiProcessedCount}/${syncLimit}] ${repo.full_name} -> ${classification.sub_category} (${provider})`,
      );

      await sleepImpl(delayMs);
    } catch (error) {
      failedCount += 1;
      const reason = sanitizeErrorMessage(error);
      errors.push(`${repo.full_name}: ${reason}`);
      logger.warn(`[sync-tools] Skipped ${repo.full_name}: ${reason}`);
    }
  }

  const errorSummary =
    errors.length > 0
      ? errors.join(" | ").slice(0, MAX_ERROR_SUMMARY_LENGTH)
      : null;

  await recordSyncLog(dbClient, {
    fetchedCount,
    aiProcessedCount,
    updatedStarsOnly,
    failedCount,
    errorSummary,
  });

  logger.info(
    `[sync-tools] Sync completed: fetched=${fetchedCount}, aiProcessed=${aiProcessedCount}, updatedStarsOnly=${updatedStarsOnly}, failed=${failedCount}, syncLimit=${syncLimit}`,
  );
  logger.info(formatClassificationTable(classified));

  return {
    fetchedCount,
    aiProcessedCount,
    updatedStarsOnly,
    failedCount,
    errorSummary,
    classified,
  };
}

if (isDirectExecution(process.argv[1], import.meta.url)) {
  runSync().catch((error: unknown) => {
    console.error(`[sync-tools] Fatal error: ${sanitizeErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
