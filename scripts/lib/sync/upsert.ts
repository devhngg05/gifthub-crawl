import { eq, inArray } from "drizzle-orm";
import type { DatabaseClient } from "@/db";
import { syncLogs, tools, type NewToolRow } from "@/db/schema";
import { buildToolSearchText } from "@/lib/search-engine";
import type { AiClassification } from "@/lib/validator";
import type { GitHubRepoItem } from "../github";
import type { PruneDatabaseSummary } from "./prune";

export const EXISTING_QUERY_CHUNK_SIZE = 500;
export const MAX_ERROR_SUMMARY_LENGTH = 4000;

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
  skippedDueToLock?: boolean;
  skippedLowStarCount?: number;
  minEligibleStars?: number | null;
  pruneSummary?: PruneDatabaseSummary | null;
}

export interface SyncLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/** Dựng payload chuẩn để chèn bản ghi tool mới vào bảng `tools` (kèm `searchText`). */
export function buildUpsertToolValues(
  repo: GitHubRepoItem,
  readmeSha: string | null,
  classification: AiClassification,
  now: Date,
  existingUserNotes?: string | null,
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
    searchText: buildToolSearchText({
      name: repo.name,
      fullName: repo.full_name,
      language: repo.language,
      summaryVi: classification.summary_vi,
      category: classification.category,
      subCategory: classification.sub_category,
      secondarySubCategories: classification.secondary_sub_categories,
      useCases: classification.use_cases,
      replaces: classification.replaces,
      userNotes: existingUserNotes ?? null,
      topics: repo.topics,
    }),
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
    searchText: values.searchText,
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

/** Đối chiếu theo batch `EXISTING_QUERY_CHUNK_SIZE` để lấy `readmeSha` và `userNotes` hiện có trong DB. */
export async function loadExistingToolsMap(
  dbClient: DatabaseClient,
  candidates: readonly GitHubRepoItem[],
): Promise<Map<number, { readmeSha: string | null; userNotes: string | null }>> {
  const existingMap = new Map<
    number,
    { readmeSha: string | null; userNotes: string | null }
  >();

  if (candidates.length > 0) {
    const candidateIds = candidates.map((repo) => repo.id);
    for (let i = 0; i < candidateIds.length; i += EXISTING_QUERY_CHUNK_SIZE) {
      const chunk = candidateIds.slice(i, i + EXISTING_QUERY_CHUNK_SIZE);
      const existingRows = await dbClient
        .select({
          githubId: tools.githubId,
          readmeSha: tools.readmeSha,
          userNotes: tools.userNotes,
        })
        .from(tools)
        .where(inArray(tools.githubId, chunk));

      for (const row of existingRows) {
        existingMap.set(row.githubId, {
          readmeSha: row.readmeSha,
          userNotes: row.userNotes ?? null,
        });
      }
    }
  }

  return existingMap;
}

export async function updateStarsAndMetadataOnly(
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

export async function upsertClassifiedTool(
  dbClient: DatabaseClient,
  repo: GitHubRepoItem,
  readmeSha: string | null,
  classification: AiClassification,
  updatedAt: Date,
  existingUserNotes?: string | null,
): Promise<void> {
  const values = buildUpsertToolValues(
    repo,
    readmeSha,
    classification,
    updatedAt,
    existingUserNotes,
  );
  const conflictSet = buildUpsertConflictSet(values);

  await dbClient
    .insert(tools)
    .values(values)
    .onConflictDoUpdate({
      target: tools.githubId,
      set: conflictSet,
    });
}

export async function recordSyncLog(
  dbClient: DatabaseClient,
  entry: {
    fetchedCount: number;
    aiProcessedCount: number;
    updatedStarsOnly: number;
    failedCount: number;
    errorSummary: string | null;
  },
): Promise<void> {
  await dbClient.insert(syncLogs).values(entry);
}
