import type { ToolRow } from "@/db/schema";

export type NewsfeedToolRow = Omit<ToolRow, "searchText">;

export const DEFAULT_MAX_PER_CATEGORY = 4;

const MS_PER_DAY = 86_400_000;
const GEM_MIN_STARS = 300;
const GEM_MAX_STARS = 6000;
const GEM_ACTIVE_DAYS = 45;

export interface ScoreComponents {
  rawIntrinsic: number;
  freshnessScore: number;
  pushedDays: number;
}

export function toTimestampMs(value: Date | string): number {
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export function diffDays(now: Date, target: Date | string): number {
  const targetMs = toTimestampMs(target);
  if (targetMs <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, (now.getTime() - targetMs) / MS_PER_DAY);
}

/** Kiểm tra công cụ chưa phân loại (lưu trong Neon DB với `subCategory="uncategorized"` hoặc `category="other"/"uncategorized"`). */
export function isUncategorizedTool(
  tool: Pick<NewsfeedToolRow, "category" | "subCategory">,
): boolean {
  return (
    tool.subCategory === "uncategorized" ||
    tool.category === "uncategorized" ||
    tool.category === "other"
  );
}

/** Trích danh sách tên phần mềm thương mại thay thế đã làm sạch khoảng trắng. */
export function getCleanReplaces(
  replaces: readonly string[] | null | undefined,
): string[] {
  if (!Array.isArray(replaces)) {
    return [];
  }
  return replaces.map((item) => item.trim()).filter((item) => item.length > 0);
}

export function isHiddenGem(tool: NewsfeedToolRow, now: Date): boolean {
  return (
    !isUncategorizedTool(tool) &&
    tool.stars >= GEM_MIN_STARS &&
    tool.stars <= GEM_MAX_STARS &&
    diffDays(now, tool.lastPushedAt) <= GEM_ACTIVE_DAYS
  );
}

export function computeScoreComponents(
  tool: NewsfeedToolRow,
  now: Date,
): ScoreComponents {
  const popularityScore = Math.log10(Math.max(tool.stars, 1) + 1) * 18;

  const pushedDays = diffDays(now, tool.lastPushedAt);
  let pushScore = 0;
  if (pushedDays <= 7) {
    pushScore = 28;
  } else if (pushedDays <= 14) {
    pushScore = 20;
  } else if (pushedDays <= 30) {
    pushScore = 12;
  } else if (pushedDays <= 90) {
    pushScore = 4;
  }

  const createdDays = diffDays(now, tool.createdAt);
  let freshnessScore = 0;
  if (createdDays <= 3) {
    freshnessScore = 16;
  } else if (createdDays <= 7) {
    freshnessScore = 10;
  } else if (createdDays <= 14) {
    freshnessScore = 5;
  }

  let usabilityScore = 0;
  if (tool.usability === "app-ready") {
    usabilityScore = 12;
  } else if (tool.usability === "cli-tool") {
    usabilityScore = 8;
  } else if (tool.usability === "dev-required") {
    usabilityScore = 4;
  }

  const replacesBonus = getCleanReplaces(tool.replaces).length > 0 ? 10 : 0;
  const uncategorizedPenalty = isUncategorizedTool(tool) ? -25 : 0;

  const rawIntrinsic =
    popularityScore +
    pushScore +
    usabilityScore +
    replacesBonus +
    uncategorizedPenalty;

  return {
    rawIntrinsic,
    freshnessScore,
    pushedDays,
  };
}

/**
 * Chấm điểm chất lượng nội tại tại thời điểm `now` (không cộng điểm `createdAt`
 * để tránh lạm phát sao cho các repo mới thu thập).
 */
export function computeIntrinsicScore(
  tool: NewsfeedToolRow,
  now: Date,
): number {
  const { rawIntrinsic } = computeScoreComponents(tool, now);
  return Math.round(rawIntrinsic * 100) / 100;
}

/**
 * Chấm điểm nổi bật cho một công cụ tại thời điểm `now`, cân bằng 4 tín hiệu:
 * độ phổ biến log-scale, độ sôi động `lastPushedAt`, độ mới `createdAt` và tính thực dụng.
 */
export function computeRadarScore(tool: NewsfeedToolRow, now: Date): number {
  const { rawIntrinsic, freshnessScore } = computeScoreComponents(tool, now);
  return Math.round((rawIntrinsic + freshnessScore) * 100) / 100;
}

/**
 * Chọn tối đa `limit` công cụ nổi bật nhưng giới hạn mỗi nhóm danh mục lớn tối đa `maxPerCategory`
 * ở lượt chọn đầu tiên để Newsfeed luôn đa dạng mảng; nếu chưa đủ `limit` mới bổ sung theo điểm.
 */
export function selectDiverseTools<
  T extends { tool: Pick<NewsfeedToolRow, "category">; radarScore: number },
>(
  scoredTools: readonly T[],
  limit: number,
  maxPerCategory: number = DEFAULT_MAX_PER_CATEGORY,
): T[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  const safeCap = Math.max(1, Math.floor(maxPerCategory));
  if (safeLimit === 0 || scoredTools.length === 0) {
    return [];
  }

  const sorted = [...scoredTools].sort((a, b) => b.radarScore - a.radarScore);
  const categoryCounts: Record<string, number> = {};
  const selected: T[] = [];
  const overflow: T[] = [];

  for (const item of sorted) {
    const count = categoryCounts[item.tool.category] ?? 0;
    if (selected.length < safeLimit && count < safeCap) {
      selected.push(item);
      categoryCounts[item.tool.category] = count + 1;
    } else {
      overflow.push(item);
    }
  }

  for (const item of overflow) {
    if (selected.length >= safeLimit) {
      break;
    }
    selected.push(item);
  }

  return selected;
}
