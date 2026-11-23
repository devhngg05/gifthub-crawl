import { z } from "zod";
import { db, type DatabaseClient } from "@/db";
import { sanitizeErrorMessage } from "@/lib/sanitize-error";
import {
  AllProvidersExhaustedError,
  areAllProvidersUnavailable,
  classifyRepo,
  classifyRepoBatch,
  DEFAULT_MAX_COOLDOWN_WAIT_MS,
  formatRecoveryDuration,
  getActiveProviders,
  getEarliestProviderRecoveryMs,
  type BatchClassifyOutcome,
  type ClassifyRepoInput,
} from "../classifier";
import {
  fetchCandidateRepos,
  fetchCleanReadme,
  fetchRepoMetadata,
  type FetchCandidateReposOptions,
  type GitHubRepoItem,
} from "../github";
import {
  acquireSyncLock,
  parseSyncLockTtlSeconds,
  type SyncLockHandle,
} from "./lock";
import {
  getStarFloorThreshold,
  parsePruneConfig,
  pruneDatabase,
  type PruneDatabaseSummary,
} from "./prune";
import {
  runReclassifySync,
  type SyncReclassifyMode,
} from "./reclassify";
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
} from "./upsert";

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
  useLock?: boolean;
  lockTtlSeconds?: number;
  lockOwner?: string;
  acquireSyncLock?: typeof acquireSyncLock;
  enablePrune?: boolean;
  pruneOnly?: boolean;
  pruneDatabase?: typeof pruneDatabase;
  getStarFloorThreshold?: typeof getStarFloorThreshold;
  maxCooldownWaitMs?: number;
  aiTimeoutMs?: number;
  fetchCandidateOptions?: Partial<FetchCandidateReposOptions>;
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

/** Đọc và kiểm tra cờ `SYNC_PRUNE_ONLY` (`false` mặc định). */
export function parseSyncPruneOnly(rawValue?: string): boolean {
  if (rawValue === undefined || rawValue.trim() === "") {
    return false;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }

  throw new Error(
    `Invalid SYNC_PRUNE_ONLY value "${rawValue.trim()}": expected "true" or "false"`,
  );
}

/**
 * Thực thi một lượt đồng bộ dữ liệu GitHub -> AI Fallback -> Neon PostgreSQL
 * kèm Distributed Lease Lock, chống cào repo sao thấp khi DB đầy, và cắt tỉa DB tự động.
 */
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
  const acquireSyncLockImpl = options.acquireSyncLock ?? acquireSyncLock;
  const pruneDatabaseImpl = options.pruneDatabase ?? pruneDatabase;
  const getStarFloorThresholdImpl =
    options.getStarFloorThreshold ?? getStarFloorThreshold;
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
  const pruneOnly = options.pruneOnly ?? parseSyncPruneOnly(env.SYNC_PRUNE_ONLY);
  const lockTtlSeconds =
    options.lockTtlSeconds ?? parseSyncLockTtlSeconds(env.SYNC_LOCK_TTL_SECONDS);
  const maxCooldownWaitMs =
    options.maxCooldownWaitMs ?? DEFAULT_MAX_COOLDOWN_WAIT_MS;

  const hasExecuteSupport =
    typeof (dbClient as { execute?: unknown }).execute === "function";
  const useLock =
    options.useLock ??
    (options.acquireSyncLock !== undefined || hasExecuteSupport);
  const enablePrune =
    options.enablePrune ??
    (options.pruneDatabase !== undefined ||
      options.getStarFloorThreshold !== undefined ||
      hasExecuteSupport);

  const pruneConfig =
    enablePrune || pruneOnly ? parsePruneConfig(env) : undefined;

  let lockHandle: SyncLockHandle | null = null;
  if (useLock) {
    const lockResult = await acquireSyncLockImpl(dbClient, {
      ttlSeconds: lockTtlSeconds,
      now,
      ownerId: options.lockOwner,
      logger,
    });

    if (!lockResult.acquired) {
      const holderDesc = lockResult.activeHolder?.ranAt
        ? `active since ${lockResult.activeHolder.ranAt}`
        : "active lease held";
      logger.info(
        `[sync-tools] Another sync worker is already running (${holderDesc}); exiting cleanly with status 0.`,
      );
      return {
        fetchedCount: 0,
        aiProcessedCount: 0,
        updatedStarsOnly: 0,
        failedCount: 0,
        errorSummary: null,
        classified: [],
        skippedDueToLock: true,
      };
    }

    lockHandle = lockResult.handle;
  }

  try {
    if (pruneOnly) {
      const pruneSummary = await pruneDatabaseImpl(dbClient, {
        config: pruneConfig,
        env,
        logger,
      });
      return {
        fetchedCount: 0,
        aiProcessedCount: 0,
        updatedStarsOnly: 0,
        failedCount: 0,
        errorSummary: null,
        classified: [],
        skippedDueToLock: false,
        pruneSummary,
      };
    }

    if (reclassifyMode !== "none") {
      const reclassifySummary = await runReclassifySync({
        mode: reclassifyMode,
        dbClient,
        fetchCleanReadmeImpl,
        fetchRepoMetadataImpl,
        classifyRepoBatchImpl,
        sleepImpl,
        delayMs,
        syncLimit,
        syncBatchSize,
        env,
        now,
        logger,
      });

      let pruneSummary: PruneDatabaseSummary | null = null;
      if (enablePrune) {
        try {
          pruneSummary = await pruneDatabaseImpl(dbClient, {
            config: pruneConfig,
            env,
            logger,
          });
        } catch (pruneError) {
          logger.warn(
            `[sync-tools] Post-reclassify DB prune failed (non-fatal): ${sanitizeErrorMessage(pruneError)}`,
          );
        }
      }

      return {
        ...reclassifySummary,
        ...(useLock ? { skippedDueToLock: false } : {}),
        ...(enablePrune ? { pruneSummary } : {}),
      };
    }

    let minEligibleStars: number | null = null;
    if (enablePrune && pruneConfig) {
      try {
        const floorResult = await getStarFloorThresholdImpl(
          dbClient,
          pruneConfig,
          logger,
        );
        minEligibleStars = floorResult.minEligibleStars;
      } catch (floorError) {
        logger.warn(
          `[sync-tools] Failed to evaluate DB capacity star floor (continuing without pre-filter): ${sanitizeErrorMessage(floorError)}`,
        );
      }
    }

    let candidates: GitHubRepoItem[];
    try {
      candidates = await fetchCandidatesImpl({
        ...options.fetchCandidateOptions,
        env,
      });
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
    let skippedLowStarCount = 0;
    const errors: string[] = [];
    const classified: ClassifiedRepoSummary[] = [];
    const providerCooldowns = new Map<string, number>();
    const activeProviders = getActiveProviders(env);
    // Chỉ dùng single mode khi syncBatchSize=1 hoặc caller truyền mock classifyRepo mà không truyền classifyRepoBatch
    const useBatchClassification =
      syncBatchSize > 1 &&
      (options.classifyRepoBatch !== undefined ||
        options.classifyRepo === undefined);

    let circuitBroken = false;
    const tripCircuitBreaker = (recoveryMs?: number | null) => {
      if (circuitBroken) {
        return;
      }
      circuitBroken = true;
      const effectiveRecoveryMs =
        recoveryMs ??
        getEarliestProviderRecoveryMs(
          activeProviders,
          providerCooldowns,
          now().getTime(),
        );
      const recoveryText =
        effectiveRecoveryMs !== null
          ? ` (ước tính hồi phục sớm nhất sau ~${formatRecoveryDuration(effectiveRecoveryMs)})`
          : "";
      logger.warn(
        `[sync-tools] Circuit breaker kích hoạt: toàn bộ AI provider đã cạn hạn mức/cooldown dài${recoveryText}. Dừng tải README và gọi AI cho các repo tiếp theo.`,
      );
    };

    interface PendingBatchItem {
      repo: GitHubRepoItem;
      readmeSha: string | null;
      existingUserNotes: string | null;
      classifyInput: ClassifyRepoInput;
    }

    const pendingBatch: PendingBatchItem[] = [];
    let batchNumber = 0;

    const flushPendingBatch = async () => {
      if (pendingBatch.length === 0) {
        return;
      }

      const batchItems = pendingBatch.splice(0, pendingBatch.length);
      batchNumber += 1;
      logger.info(
        `[sync-tools] Đang phân loại AI lô ${batchNumber} (${batchItems.length} repo)...`,
      );

      let outcomes: BatchClassifyOutcome[];
      try {
        outcomes = await classifyRepoBatchImpl(
          batchItems.map((item) => item.classifyInput),
          {
            env,
            providerCooldowns,
            sleep: sleepImpl,
            now: () => now().getTime(),
            maxCooldownWaitMs,
            ...(options.aiTimeoutMs !== undefined
              ? { timeoutMs: options.aiTimeoutMs }
              : {}),
          },
        );
      } catch (error) {
        const reason = sanitizeErrorMessage(error);
        for (const item of batchItems) {
          failedCount += 1;
          errors.push(`${item.repo.full_name}: ${reason}`);
          logger.warn(`[sync-tools] Skipped ${item.repo.full_name}: ${reason}`);
        }
        const isLongTerm =
          (error instanceof AllProvidersExhaustedError &&
            error.allLongTermCooldown) ||
          areAllProvidersUnavailable(
            activeProviders,
            providerCooldowns,
            now().getTime(),
            maxCooldownWaitMs,
          );
        if (isLongTerm) {
          tripCircuitBreaker(
            error instanceof AllProvidersExhaustedError
              ? error.earliestRecoveryMs
              : null,
          );
        }
        return;
      }

      let batchHitLongTermCooldown = false;

      for (let i = 0; i < batchItems.length; i += 1) {
        const item = batchItems[i];
        const outcome = outcomes[i];

        if (!outcome || !outcome.ok) {
          failedCount += 1;
          const reason = outcome
            ? outcome.error
            : "Missing classification outcome";
          errors.push(`${item.repo.full_name}: ${reason}`);
          logger.warn(`[sync-tools] Skipped ${item.repo.full_name}: ${reason}`);
          if (outcome && !outcome.ok && outcome.allProvidersLongTermCooldown) {
            batchHitLongTermCooldown = true;
          }
          continue;
        }

        try {
          await upsertClassifiedTool(
            dbClient,
            item.repo,
            item.readmeSha,
            outcome.result.classification,
            now(),
            item.existingUserNotes,
          );

          aiProcessedCount += 1;
          classified.push({
            fullName: item.repo.full_name,
            provider: outcome.result.provider,
            subCategory: outcome.result.classification.sub_category,
            usability: outcome.result.classification.usability,
          });

          logger.info(
            `[sync-tools] [${aiProcessedCount}/${syncLimit}] ${item.repo.full_name} -> ${outcome.result.classification.sub_category} (${outcome.result.provider})`,
          );
        } catch (dbError) {
          failedCount += 1;
          const reason = sanitizeErrorMessage(dbError);
          errors.push(`${item.repo.full_name}: ${reason}`);
          logger.warn(
            `[sync-tools] Skipped DB upsert ${item.repo.full_name}: ${reason}`,
          );
        }
      }

      if (
        batchHitLongTermCooldown ||
        areAllProvidersUnavailable(
          activeProviders,
          providerCooldowns,
          now().getTime(),
          maxCooldownWaitMs,
        )
      ) {
        tripCircuitBreaker();
      }
    };

    for (const repo of candidates) {
      try {
        const existing = existingMap.get(repo.id);

        // Khi Circuit Breaker đã kích hoạt: tuyệt đối không tải README hay gọi AI, chỉ cập nhật stars cho repo đã tồn tại.
        if (circuitBroken) {
          if (existing !== undefined) {
            await updateStarsAndMetadataOnly(dbClient, repo, now());
            updatedStarsOnly += 1;
          }
          continue;
        }

        // DB đang gần đầy: bỏ qua repo mới có sao <= ngưỡng sàn để không tốn quota AI cào rồi bị cắt tỉa.
        if (
          existing === undefined &&
          minEligibleStars !== null &&
          repo.stargazers_count <= minEligibleStars
        ) {
          skippedLowStarCount += 1;
          continue;
        }

        // Repo mới nhưng đã chạm SYNC_LIMIT: xả lô đang chờ (nếu có) và dừng vòng lặp sớm.
        if (!existing && aiAttemptedCount >= syncLimit) {
          await flushPendingBatch();
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
        const classifyInput: ClassifyRepoInput = {
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description ?? "",
          homepage: repo.homepage ?? null,
          language: repo.language,
          topics: repo.topics,
          readmeText: readme.text,
        };

        if (useBatchClassification) {
          pendingBatch.push({
            repo,
            readmeSha: readme.sha,
            existingUserNotes: existing?.userNotes ?? null,
            classifyInput,
          });

          if (
            pendingBatch.length >= syncBatchSize ||
            aiAttemptedCount >= syncLimit
          ) {
            await flushPendingBatch();
            if (!circuitBroken && aiAttemptedCount < syncLimit && delayMs > 0) {
              await sleepImpl(delayMs);
            }
          }
          continue;
        }

        if ((aiAttemptedCount - 1) % syncBatchSize === 0) {
          const singleBatchNumber =
            Math.floor((aiAttemptedCount - 1) / syncBatchSize) + 1;
          const batchSize = Math.min(
            syncBatchSize,
            syncLimit - (singleBatchNumber - 1) * syncBatchSize,
          );
          logger.info(
            `[sync-tools] Đang tải README & phân loại lô ${singleBatchNumber} (${batchSize} repo)...`,
          );
        }

        const { classification, provider } = await classifyRepoImpl(
          classifyInput,
          {
            env,
            providerCooldowns,
            sleep: sleepImpl,
            now: () => now().getTime(),
            maxCooldownWaitMs,
            ...(options.aiTimeoutMs !== undefined
              ? { timeoutMs: options.aiTimeoutMs }
              : {}),
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

        const isLongTerm =
          (error instanceof AllProvidersExhaustedError &&
            error.allLongTermCooldown) ||
          areAllProvidersUnavailable(
            activeProviders,
            providerCooldowns,
            now().getTime(),
            maxCooldownWaitMs,
          );
        if (isLongTerm) {
          tripCircuitBreaker(
            error instanceof AllProvidersExhaustedError
              ? error.earliestRecoveryMs
              : null,
          );
        }
      }
    }

    await flushPendingBatch();

    if (skippedLowStarCount > 0) {
      logger.info(
        `[sync-tools] Đã bỏ qua ${skippedLowStarCount} repo mới có <= ${minEligibleStars} sao do DB gần ngưỡng dung lượng.`,
      );
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

    let pruneSummary: PruneDatabaseSummary | null = null;
    if (enablePrune) {
      try {
        pruneSummary = await pruneDatabaseImpl(dbClient, {
          config: pruneConfig,
          env,
          logger,
        });
      } catch (pruneError) {
        logger.warn(
          `[sync-tools] Post-sync DB prune failed (non-fatal): ${sanitizeErrorMessage(pruneError)}`,
        );
      }
    }

    logger.info(
      `[sync-tools] Sync completed: fetched=${fetchedCount}, aiProcessed=${aiProcessedCount}, updatedStarsOnly=${updatedStarsOnly}, failed=${failedCount}, skippedLowStar=${skippedLowStarCount}, syncLimit=${syncLimit}`,
    );
    logger.info(formatClassificationTable(classified));

    return {
      fetchedCount,
      aiProcessedCount,
      updatedStarsOnly,
      failedCount,
      errorSummary,
      classified,
      ...(useLock ? { skippedDueToLock: false } : {}),
      ...(skippedLowStarCount > 0 || minEligibleStars !== null
        ? { skippedLowStarCount, minEligibleStars }
        : {}),
      ...(enablePrune ? { pruneSummary } : {}),
    };
  } finally {
    if (lockHandle) {
      await lockHandle.release();
    }
  }
}
