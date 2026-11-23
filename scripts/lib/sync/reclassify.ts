import { asc, desc, eq } from "drizzle-orm";
import type { DatabaseClient } from "@/db";
import { tools } from "@/db/schema";
import { sanitizeErrorMessage } from "@/lib/sanitize-error";
import { buildToolSearchText } from "@/lib/search-engine";
import type { AiClassification } from "@/lib/validator";
import {
  AllProvidersExhaustedError,
  areAllProvidersUnavailable,
  DEFAULT_MAX_COOLDOWN_WAIT_MS,
  formatRecoveryDuration,
  getActiveProviders,
  getEarliestProviderRecoveryMs,
  type BatchClassifyOutcome,
  type classifyRepoBatch,
  type ClassifyRepoInput,
} from "../classifier";
import type { fetchCleanReadme, fetchRepoMetadata } from "../github";
import {
  formatClassificationTable,
  MAX_ERROR_SUMMARY_LENGTH,
  recordSyncLog,
  type ClassifiedRepoSummary,
  type SyncLogger,
  type SyncRunSummary,
  type UpsertToolValues,
} from "./upsert";

export const RECLASSIFY_FETCH_CONCURRENCY = 5;

export type SyncReclassifyMode = "none" | "uncategorized" | "all";

export type ReclassifyUpdateSet = Pick<
  UpsertToolValues,
  | "category"
  | "subCategory"
  | "secondarySubCategories"
  | "usability"
  | "summaryVi"
  | "useCases"
  | "replaces"
  | "readmeSha"
  | "searchText"
  | "updatedAt"
>;

/**
 * Dựng tập trường cập nhật khi chạy `SYNC_RECLASSIFY` cho các công cụ đã lưu.
 * Chỉ cập nhật các trường AI + `searchText` + dấu thời gian, TUYỆT ĐỐI không chạm `isPinned` và `userNotes`.
 */
export function buildReclassifyUpdateSet(
  readmeSha: string | null,
  classification: AiClassification,
  updatedAt: Date,
  context?: {
    name: string;
    fullName: string;
    language?: string | null;
    userNotes?: string | null;
    topics?: readonly string[];
  },
): ReclassifyUpdateSet {
  return {
    category: classification.category,
    subCategory: classification.sub_category,
    secondarySubCategories: classification.secondary_sub_categories,
    usability: classification.usability,
    summaryVi: classification.summary_vi,
    useCases: classification.use_cases,
    replaces: classification.replaces,
    readmeSha,
    searchText: buildToolSearchText({
      name: context?.name ?? "",
      fullName: context?.fullName ?? "",
      language: context?.language ?? null,
      summaryVi: classification.summary_vi,
      category: classification.category,
      subCategory: classification.sub_category,
      secondarySubCategories: classification.secondary_sub_categories,
      useCases: classification.use_cases,
      replaces: classification.replaces,
      userNotes: context?.userNotes ?? null,
      topics: context?.topics ?? [],
    }),
    updatedAt,
  };
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.min(items.length, Math.max(1, Math.floor(concurrency)));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        return;
      }
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

interface ReclassifyCandidateRow {
  id: number;
  githubId: number;
  name: string;
  fullName: string;
  language: string | null;
  summaryVi: string;
  userNotes?: string | null;
}

type PreparedReclassifyEntry =
  | {
      ok: true;
      row: ReclassifyCandidateRow;
      readmeSha: string | null;
      classifyInput: ClassifyRepoInput;
    }
  | {
      ok: false;
      row: ReclassifyCandidateRow;
      error: string;
    };

export async function runReclassifySync(params: {
  mode: Exclude<SyncReclassifyMode, "none">;
  dbClient: DatabaseClient;
  fetchCleanReadmeImpl: typeof fetchCleanReadme;
  fetchRepoMetadataImpl: typeof fetchRepoMetadata;
  classifyRepoBatchImpl: typeof classifyRepoBatch;
  sleepImpl: (ms: number) => Promise<void>;
  delayMs: number;
  syncLimit: number;
  syncBatchSize: number;
  env?: Record<string, string | undefined>;
  now: () => Date;
  logger: SyncLogger;
}): Promise<SyncRunSummary> {
  const {
    mode,
    dbClient,
    fetchCleanReadmeImpl,
    fetchRepoMetadataImpl,
    classifyRepoBatchImpl,
    sleepImpl,
    delayMs,
    syncLimit,
    syncBatchSize,
    env = process.env,
    now,
    logger,
  } = params;

  const baseSelect = dbClient
    .select({
      id: tools.id,
      githubId: tools.githubId,
      name: tools.name,
      fullName: tools.fullName,
      language: tools.language,
      summaryVi: tools.summaryVi,
      userNotes: tools.userNotes,
    })
    .from(tools);

  const rows: ReclassifyCandidateRow[] =
    mode === "uncategorized"
      ? await baseSelect
          .where(eq(tools.subCategory, "uncategorized"))
          .orderBy(desc(tools.stars), asc(tools.id))
          .limit(syncLimit)
      : await baseSelect
          .orderBy(asc(tools.updatedAt), desc(tools.stars), asc(tools.id))
          .limit(syncLimit);

  const fetchedCount = rows.length;
  logger.info(
    `[sync-tools] Chế độ phân loại lại (${mode}): tìm thấy ${fetchedCount} công cụ (limit=${syncLimit}, batchSize=${syncBatchSize}).`,
  );

  let aiProcessedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];
  const classified: ClassifiedRepoSummary[] = [];
  const providerCooldowns = new Map<string, number>();
  const activeProviders = getActiveProviders(env);

  const totalBatches = Math.ceil(rows.length / syncBatchSize);
  for (let bIdx = 0; bIdx < totalBatches; bIdx += 1) {
    const chunk = rows.slice(
      bIdx * syncBatchSize,
      (bIdx + 1) * syncBatchSize,
    );
    const batchNumber = bIdx + 1;
    logger.info(
      `[sync-tools] Đang tải metadata + README & phân loại lại lô ${batchNumber}/${totalBatches} (${chunk.length} repo)...`,
    );

    const prepared = await mapWithConcurrency<
      ReclassifyCandidateRow,
      PreparedReclassifyEntry
    >(chunk, RECLASSIFY_FETCH_CONCURRENCY, async (row) => {
      try {
        const [metaResult, readmeResult] = await Promise.allSettled([
          fetchRepoMetadataImpl(row.fullName),
          fetchCleanReadmeImpl(row.fullName),
        ]);

        if (readmeResult.status === "rejected") {
          throw readmeResult.reason;
        }

        const meta =
          metaResult.status === "fulfilled" ? metaResult.value : null;

        return {
          ok: true,
          row,
          readmeSha: readmeResult.value.sha,
          classifyInput: {
            name: meta?.name ?? row.name,
            fullName: meta?.full_name ?? row.fullName,
            description: meta?.description ?? row.summaryVi,
            homepage: meta?.homepage ?? null,
            language: meta?.language ?? row.language,
            topics: meta?.topics ?? [],
            readmeText: readmeResult.value.text,
          },
        };
      } catch (error) {
        return {
          ok: false,
          row,
          error: sanitizeErrorMessage(error),
        };
      }
    });

    const readyEntries: Array<Extract<PreparedReclassifyEntry, { ok: true }>> =
      [];

    for (const item of prepared) {
      if (item.ok) {
        readyEntries.push(item);
      } else {
        failedCount += 1;
        errors.push(`${item.row.fullName}: ${item.error}`);
        logger.warn(
          `[sync-tools] Skipped reclassify ${item.row.fullName}: ${item.error}`,
        );
      }
    }

    if (readyEntries.length > 0) {
      let outcomes: BatchClassifyOutcome[] | null = null;
      let batchHitLongTermCooldown = false;
      let explicitRecoveryMs: number | null = null;

      try {
        outcomes = await classifyRepoBatchImpl(
          readyEntries.map((entry) => entry.classifyInput),
          {
            env,
            providerCooldowns,
            sleep: sleepImpl,
            now: () => now().getTime(),
          },
        );
      } catch (batchError) {
        const reason = sanitizeErrorMessage(batchError);
        for (const entry of readyEntries) {
          failedCount += 1;
          errors.push(`${entry.row.fullName}: ${reason}`);
          logger.warn(
            `[sync-tools] Skipped reclassify ${entry.row.fullName}: ${reason}`,
          );
        }
        if (
          batchError instanceof AllProvidersExhaustedError &&
          batchError.allLongTermCooldown
        ) {
          batchHitLongTermCooldown = true;
          explicitRecoveryMs = batchError.earliestRecoveryMs;
        }
      }

      if (outcomes) {
        for (let i = 0; i < readyEntries.length; i += 1) {
          const entry = readyEntries[i];
          const outcome = outcomes[i];

          if (!outcome || !outcome.ok) {
            failedCount += 1;
            const reason = outcome
              ? outcome.error
              : "Missing classification outcome";
            errors.push(`${entry.row.fullName}: ${reason}`);
            logger.warn(
              `[sync-tools] Skipped reclassify ${entry.row.fullName}: ${reason}`,
            );
            if (
              outcome &&
              !outcome.ok &&
              outcome.allProvidersLongTermCooldown
            ) {
              batchHitLongTermCooldown = true;
            }
            continue;
          }

          try {
            const updateSet = buildReclassifyUpdateSet(
              entry.readmeSha,
              outcome.result.classification,
              now(),
              {
                name: entry.classifyInput.name,
                fullName: entry.classifyInput.fullName,
                language: entry.classifyInput.language,
                userNotes: entry.row.userNotes ?? null,
                topics: entry.classifyInput.topics,
              },
            );
            await dbClient
              .update(tools)
              .set(updateSet)
              .where(eq(tools.id, entry.row.id));

            aiProcessedCount += 1;
            classified.push({
              fullName: entry.row.fullName,
              provider: outcome.result.provider,
              subCategory: outcome.result.classification.sub_category,
              usability: outcome.result.classification.usability,
            });
            logger.info(
              `[sync-tools] [reclassify ${aiProcessedCount}/${rows.length}] ${entry.row.fullName} -> ${outcome.result.classification.sub_category} (${outcome.result.provider})`,
            );
          } catch (dbError) {
            failedCount += 1;
            const reason = sanitizeErrorMessage(dbError);
            errors.push(`${entry.row.fullName}: ${reason}`);
            logger.warn(
              `[sync-tools] Skipped DB update ${entry.row.fullName}: ${reason}`,
            );
          }
        }
      }

      const shouldBreakCircuit =
        batchHitLongTermCooldown ||
        areAllProvidersUnavailable(
          activeProviders,
          providerCooldowns,
          now().getTime(),
          DEFAULT_MAX_COOLDOWN_WAIT_MS,
        );

      if (shouldBreakCircuit) {
        const recoveryMs =
          explicitRecoveryMs ??
          getEarliestProviderRecoveryMs(
            activeProviders,
            providerCooldowns,
            now().getTime(),
          );
        const recoveryText =
          recoveryMs !== null
            ? ` (ước tính hồi phục sớm nhất sau ~${formatRecoveryDuration(recoveryMs)})`
            : "";
        logger.warn(
          `[sync-tools] Circuit breaker kích hoạt (reclassify): toàn bộ AI provider đã cạn hạn mức/cooldown dài${recoveryText}. Dừng tải metadata/README và gọi AI cho các lô còn lại.`,
        );
        break;
      }

      if (bIdx < totalBatches - 1 && delayMs > 0) {
        await sleepImpl(delayMs);
      }
    }
  }

  const errorSummary =
    errors.length > 0
      ? errors.join(" | ").slice(0, MAX_ERROR_SUMMARY_LENGTH)
      : null;

  await recordSyncLog(dbClient, {
    fetchedCount,
    aiProcessedCount,
    updatedStarsOnly: 0,
    failedCount,
    errorSummary,
  });

  logger.info(
    `[sync-tools] Reclassify (${mode}) completed: fetched=${fetchedCount}, aiProcessed=${aiProcessedCount}, failed=${failedCount}, syncLimit=${syncLimit}`,
  );
  logger.info(formatClassificationTable(classified));

  return {
    fetchedCount,
    aiProcessedCount,
    updatedStarsOnly: 0,
    failedCount,
    errorSummary,
    classified,
  };
}
