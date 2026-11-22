import "./load-env";

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type DatabaseClient } from "@/db";
import { syncLogs, tools, type NewToolRow } from "@/db/schema";
import type { AiClassification } from "@/lib/validator";
import { classifyRepo } from "./lib/classifier";
import {
  fetchCandidateRepos,
  fetchCleanReadme,
  type GitHubRepoItem,
} from "./lib/github";

export const DEFAULT_SYNC_LIMIT = 20;
export const AI_RATE_LIMIT_DELAY_MS = 1500;
const MAX_ERROR_SUMMARY_LENGTH = 4000;

export type UpsertToolValues = Omit<
  NewToolRow,
  "id" | "isPinned" | "userNotes" | "createdAt"
> & {
  updatedAt: Date;
};

export type UpsertToolConflictSet = Omit<UpsertToolValues, "githubId">;

export interface ClassifiedRepoSummary {
  fullName: string;
  provider: string;
  subCategory: string;
  usability: string;
}

export interface SyncRunSummary {
  fetchedCount: number;
  aiProcessedCount: number;
  updatedStarsOnly: number;
  failedCount: number;
  errorSummary: string | null;
  classified: ClassifiedRepoSummary[];
}

export interface SyncLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface RunSyncOptions {
  db?: DatabaseClient;
  fetchCandidateRepos?: typeof fetchCandidateRepos;
  fetchCleanReadme?: typeof fetchCleanReadme;
  classifyRepo?: typeof classifyRepo;
  sleep?: (ms: number) => Promise<void>;
  env?: Record<string, string | undefined>;
  delayMs?: number;
  now?: () => Date;
  logger?: SyncLogger;
}

const SyncLimitSchema = z.coerce.number().int().positive();

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

/** Làm sạch thông điệp lỗi trước khi log hoặc lưu DB, che mọi secret/URL kết nối. */
export function sanitizeErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);

  const redacted = raw
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/Bearer\s+[^\s"'`]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:gsk|ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_-]+/g,
      "[REDACTED_TOKEN]",
    )
    .replace(/\bgithub_pat_[A-Za-z0-9_]+/g, "[REDACTED_TOKEN]")
    .replace(/\bsk-or-[A-Za-z0-9_-]+/g, "[REDACTED_TOKEN]")
    .replace(/\s+/g, " ")
    .trim();

  return redacted.length > 0 ? redacted : "Unknown error";
}

/** Dựng payload chuẩn để chèn bản ghi tool mới vào bảng `tools`. */
export function buildUpsertToolValues(
  repo: GitHubRepoItem,
  readmeSha: string | null,
  classification: AiClassification,
  now: Date,
): UpsertToolValues {
  return {
    githubId: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    htmlUrl: repo.html_url,
    stars: repo.stargazers_count,
    language: repo.language,
    lastPushedAt: new Date(repo.pushed_at),
    readmeSha,
    summaryVi: classification.summary_vi,
    category: classification.category,
    subCategory: classification.sub_category,
    secondarySubCategories: classification.secondary_sub_categories,
    useCases: classification.use_cases,
    replaces: classification.replaces,
    usability: classification.usability,
    updatedAt: now,
  };
}

/**
 * Dựng tập trường cập nhật khi trùng `githubId`.
 * Tuyệt đối loại trừ `isPinned`, `userNotes`, `id`, `githubId` và `createdAt`.
 */
export function buildUpsertConflictSet(
  values: UpsertToolValues,
): UpsertToolConflictSet {
  return {
    name: values.name,
    fullName: values.fullName,
    htmlUrl: values.htmlUrl,
    stars: values.stars,
    language: values.language,
    lastPushedAt: values.lastPushedAt,
    readmeSha: values.readmeSha,
    summaryVi: values.summaryVi,
    category: values.category,
    subCategory: values.subCategory,
    secondarySubCategories: values.secondarySubCategories,
    useCases: values.useCases,
    replaces: values.replaces,
    usability: values.usability,
    updatedAt: values.updatedAt,
  };
}

/** Định dạng bảng tóm tắt các repository vừa được phân loại AI. */
export function formatClassificationTable(
  rows: readonly ClassifiedRepoSummary[],
): string {
  if (rows.length === 0) {
    return "Không có repository nào cần phân loại AI trong lượt chạy này.";
  }

  const headers = [
    "Tên repo",
    "Provider đã dùng",
    "subCategory",
    "usability",
  ] as const;

  const widths: [number, number, number, number] = [
    Math.max(headers[0].length, ...rows.map((r) => r.fullName.length)),
    Math.max(headers[1].length, ...rows.map((r) => r.provider.length)),
    Math.max(headers[2].length, ...rows.map((r) => r.subCategory.length)),
    Math.max(headers[3].length, ...rows.map((r) => r.usability.length)),
  ];

  const formatRow = (cols: readonly [string, string, string, string]): string =>
    cols.map((col, idx) => col.padEnd(widths[idx])).join(" | ");

  const separator = widths.map((w) => "-".repeat(w)).join("-|-");

  return [
    formatRow(headers),
    separator,
    ...rows.map((r) =>
      formatRow([r.fullName, r.provider, r.subCategory, r.usability]),
    ),
  ].join("\n");
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

async function updateStarsAndMetadataOnly(
  dbClient: DatabaseClient,
  repo: GitHubRepoItem,
  updatedAt: Date,
): Promise<void> {
  await dbClient
    .update(tools)
    .set({
      stars: repo.stargazers_count,
      lastPushedAt: new Date(repo.pushed_at),
      updatedAt,
    })
    .where(eq(tools.githubId, repo.id));
}

/** Thực thi một lượt đồng bộ dữ liệu GitHub → AI Fallback → Neon PostgreSQL. */
export async function runSync(
  options: RunSyncOptions = {},
): Promise<SyncRunSummary> {
  const dbClient = options.db ?? db;
  const fetchCandidatesImpl =
    options.fetchCandidateRepos ?? fetchCandidateRepos;
  const fetchCleanReadmeImpl = options.fetchCleanReadme ?? fetchCleanReadme;
  const classifyRepoImpl = options.classifyRepo ?? classifyRepo;
  const sleepImpl = options.sleep ?? defaultSleep;
  const env = options.env ?? process.env;
  const delayMs = options.delayMs ?? AI_RATE_LIMIT_DELAY_MS;
  const now = options.now ?? (() => new Date());
  const logger: SyncLogger = options.logger ?? {
    info: (message) => console.log(message),
    warn: (message) => console.warn(message),
    error: (message) => console.error(message),
  };

  const syncLimit = parseSyncLimit(env.SYNC_LIMIT);

  let candidates: GitHubRepoItem[];
  try {
    candidates = await fetchCandidatesImpl();
  } catch (error) {
    const summary = sanitizeErrorMessage(error).slice(
      0,
      MAX_ERROR_SUMMARY_LENGTH,
    );
    try {
      await dbClient.insert(syncLogs).values({
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
  const existingMap = new Map<number, { readmeSha: string | null }>();

  if (candidates.length > 0) {
    const candidateIds = candidates.map((repo) => repo.id);
    const existingRows = await dbClient
      .select({
        githubId: tools.githubId,
        readmeSha: tools.readmeSha,
      })
      .from(tools)
      .where(inArray(tools.githubId, candidateIds));

    for (const row of existingRows) {
      existingMap.set(row.githubId, { readmeSha: row.readmeSha });
    }
  }

  let aiAttemptedCount = 0;
  let aiProcessedCount = 0;
  let updatedStarsOnly = 0;
  let failedCount = 0;
  const errors: string[] = [];
  const classified: ClassifiedRepoSummary[] = [];

  for (const repo of candidates) {
    try {
      const existing = existingMap.get(repo.id);

      // Repo mới nhưng đã chạm SYNC_LIMIT: bỏ qua sớm để tiết kiệm GitHub/AI quota.
      if (!existing && aiAttemptedCount >= syncLimit) {
        continue;
      }

      const readme = await fetchCleanReadmeImpl(repo.full_name);

      // Idempotency theo readmeSha HOẶC repo cũ đổi SHA sau khi đã chạm SYNC_LIMIT:
      // chỉ cập nhật stars/lastPushedAt/updatedAt, giữ nguyên readmeSha cũ để lượt sau phân loại lại.
      if (
        existing !== undefined &&
        (existing.readmeSha === readme.sha || aiAttemptedCount >= syncLimit)
      ) {
        await updateStarsAndMetadataOnly(dbClient, repo, now());
        updatedStarsOnly += 1;
        continue;
      }

      aiAttemptedCount += 1;

      const { classification, provider } = await classifyRepoImpl({
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description ?? "",
        language: repo.language,
        topics: repo.topics,
        readmeText: readme.text,
      });

      const values = buildUpsertToolValues(
        repo,
        readme.sha,
        classification,
        now(),
      );
      const conflictSet = buildUpsertConflictSet(values);

      await dbClient
        .insert(tools)
        .values(values)
        .onConflictDoUpdate({
          target: tools.githubId,
          set: conflictSet,
        });

      aiProcessedCount += 1;
      classified.push({
        fullName: repo.full_name,
        provider,
        subCategory: classification.sub_category,
        usability: classification.usability,
      });

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

  await dbClient.insert(syncLogs).values({
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
