import "./load-env";

import { asc, eq, sql } from "drizzle-orm";
import { SUB_CATEGORY_MAP, isValidSubCategory } from "@/config/taxonomy";
import { db, type DatabaseClient } from "@/db";
import { tools } from "@/db/schema";
import { sanitizeErrorMessage } from "@/lib/sanitize-error";
import { buildToolSearchText } from "@/lib/search-engine";
import { isDirectExecution } from "./sync-tools";

export const DEFAULT_BACKFILL_BATCH_SIZE = 100;

export interface BackfillSearchTextOptions {
  db?: DatabaseClient;
  batchSize?: number;
  logger?: { info: (message: string) => void };
}

export interface BackfillSearchTextResult {
  totalRows: number;
  updatedRows: number;
  syncedCategoryRows: number;
}

/**
 * Chuẩn hóa lại cột `category` theo `SUB_CATEGORY_MAP` nếu bản ghi có `subCategory` hợp lệ
 * nhưng `category` trong DB bị lệch so với taxonomy chuẩn.
 */
export function resolveNormalizedCategoryForRow(row: {
  category: string;
  subCategory: string;
}): { nextCategory: string; categorySynced: boolean } {
  if (!isValidSubCategory(row.subCategory)) {
    return { nextCategory: row.category, categorySynced: false };
  }

  const canonicalCategory = SUB_CATEGORY_MAP[row.subCategory].category;
  return {
    nextCategory: canonicalCategory,
    categorySynced: row.category !== canonicalCategory,
  };
}

/**
 * 1. Bật extension `pg_trgm` và tạo GIN trigram index trên `tools.search_text`.
 * 2. Chuẩn hóa cột `category` bị lệch (nếu có) và tính lại `search_text` theo batch cho toàn bộ công cụ.
 */
export async function backfillSearchText(
  options: BackfillSearchTextOptions = {},
): Promise<BackfillSearchTextResult> {
  const dbClient = options.db ?? db;
  const batchSize = Math.max(
    1,
    Math.floor(options.batchSize ?? DEFAULT_BACKFILL_BATCH_SIZE),
  );
  const logger = options.logger ?? {
    info: (message: string) => console.log(message),
  };

  logger.info("[backfill] Đang bật extension pg_trgm trên Neon PostgreSQL...");
  await dbClient.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  logger.info(
    "[backfill] Đang tạo GIN trigram index tools_search_text_trgm_idx...",
  );
  await dbClient.execute(
    sql`CREATE INDEX IF NOT EXISTS tools_search_text_trgm_idx ON tools USING gin (search_text gin_trgm_ops)`,
  );

  const rows = await dbClient
    .select({
      id: tools.id,
      name: tools.name,
      fullName: tools.fullName,
      language: tools.language,
      summaryVi: tools.summaryVi,
      category: tools.category,
      subCategory: tools.subCategory,
      secondarySubCategories: tools.secondarySubCategories,
      useCases: tools.useCases,
      replaces: tools.replaces,
      userNotes: tools.userNotes,
    })
    .from(tools)
    .orderBy(asc(tools.id));

  logger.info(`[backfill] Tìm thấy ${rows.length} công cụ cần cập nhật search_text.`);

  let updatedRows = 0;
  let syncedCategoryRows = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    let batchSyncedCategoryCount = 0;
    await Promise.all(
      batch.map((row) => {
        const { nextCategory, categorySynced } =
          resolveNormalizedCategoryForRow(row);
        if (categorySynced) {
          batchSyncedCategoryCount += 1;
        }
        const nextSearchText = buildToolSearchText({
          name: row.name,
          fullName: row.fullName,
          language: row.language,
          summaryVi: row.summaryVi,
          category: nextCategory,
          subCategory: row.subCategory,
          secondarySubCategories: row.secondarySubCategories,
          useCases: row.useCases,
          replaces: row.replaces,
          userNotes: row.userNotes,
        });
        return dbClient
          .update(tools)
          .set({
            searchText: nextSearchText,
            ...(categorySynced ? { category: nextCategory } : {}),
          })
          .where(eq(tools.id, row.id));
      }),
    );

    updatedRows += batch.length;
    syncedCategoryRows += batchSyncedCategoryCount;
    logger.info(`[backfill] Đã cập nhật ${updatedRows}/${rows.length} công cụ.`);
  }

  if (syncedCategoryRows > 0) {
    logger.info(
      `[backfill] Đã chuẩn hóa cột category cho ${syncedCategoryRows} bản ghi lệch danh mục.`,
    );
  }
  logger.info("[backfill] Hoàn tất backfill search_text và index pg_trgm.");
  return { totalRows: rows.length, updatedRows, syncedCategoryRows };
}

if (isDirectExecution(process.argv[1], import.meta.url)) {
  backfillSearchText().catch((error: unknown) => {
    console.error(`[backfill] Fatal error: ${sanitizeErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
