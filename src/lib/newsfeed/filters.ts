import { isValidCategory, type CategorySlug } from "@/config/taxonomy";
import type { RawSearchParams } from "@/lib/ui-helpers";
import { VALID_USABILITY_LEVELS, type UsabilityLevel } from "@/lib/validator";
import {
  buildNewsfeedHighlight,
  computeQualityRating,
  type NewsfeedTab,
  type QualityRating,
  type QualityTier,
} from "./quality";
import {
  computeRadarScore,
  DEFAULT_MAX_PER_CATEGORY,
  diffDays,
  getCleanReplaces,
  isHiddenGem,
  isUncategorizedTool,
  selectDiverseTools,
  toTimestampMs,
  type NewsfeedToolRow,
} from "./scoring";
import { buildCuratedToolkits, type CuratedToolkit } from "./toolkits";

export type NewsfeedWindow = "7d" | "30d" | "all";
export type NewsfeedQualityFilter = "high" | "top";

export interface NewsfeedTabMeta {
  readonly id: NewsfeedTab;
  readonly label: string;
  readonly description: string;
}

export const NEWSFEED_TABS: readonly NewsfeedTabMeta[] = [
  {
    id: "spotlight",
    label: "Đáng chú ý",
    description:
      "Cân bằng độ phổ biến, nhịp độ cập nhật gần đây và sự đa dạng nhiều nhóm danh mục.",
  },
  {
    id: "fresh",
    label: "Mới vào",
    description:
      "Các công cụ vừa được radar thu thập gần đây theo thời điểm thêm vào kho.",
  },
  {
    id: "gems",
    label: "Tiềm năng",
    description:
      "Dự án 300–6.000 sao đang phát triển sôi động trong 45 ngày gần nhất.",
  },
  {
    id: "alternatives",
    label: "Thay bản trả phí",
    description:
      "Giải pháp mã nguồn mở thay thế phần mềm thương mại, ưu tiên dùng được ngay.",
  },
  {
    id: "ready",
    label: "Dùng ngay",
    description:
      "Công cụ cài là dùng ngay (App/Docker) hoặc CLI tiện lợi không cần tự build phức tạp.",
  },
] as const;

export const NEWSFEED_WINDOWS: readonly {
  readonly id: NewsfeedWindow;
  readonly label: string;
}[] = [
  { id: "7d", label: "7 ngày" },
  { id: "30d", label: "30 ngày" },
  { id: "all", label: "Tất cả" },
] as const;

export const NEWSFEED_MAX_ITEMS = 24;

const VALID_TAB_SET = new Set<string>(NEWSFEED_TABS.map((t) => t.id));
const VALID_WINDOW_SET = new Set<string>(NEWSFEED_WINDOWS.map((w) => w.id));
const VALID_USABILITY_SET = new Set<string>(VALID_USABILITY_LEVELS);
const VALID_QUALITY_SET = new Set<string>(["high", "top"]);

export interface NewsfeedParams {
  tab: NewsfeedTab;
  window: NewsfeedWindow;
  category?: CategorySlug;
  usability?: UsabilityLevel;
  quality?: NewsfeedQualityFilter;
}

export interface ScoredNewsfeedTool {
  tool: NewsfeedToolRow;
  radarScore: number;
  highlightBadge: string;
  quality: QualityRating;
}

export interface NewsfeedData {
  params: NewsfeedParams;
  effectiveWindow: NewsfeedWindow;
  didRelaxWindow: boolean;
  items: ScoredNewsfeedTool[];
  totalMatchedInTab: number;
  tabCounts: Record<NewsfeedTab, number>;
  pulse: {
    newLast7Days: number;
    activeGems: number;
    totalTools: number;
    topRatedCount: number;
  };
  toolkits: CuratedToolkit[];
}

function getSingleParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Chuẩn hóa tham số query trên URL `/newsfeed` thành cấu trúc an toàn. */
export function parseNewsfeedParams(
  rawParams: RawSearchParams,
): NewsfeedParams {
  const rawTab = getSingleParam(rawParams.tab)?.trim();
  const tab: NewsfeedTab =
    rawTab && VALID_TAB_SET.has(rawTab)
      ? (rawTab as NewsfeedTab)
      : "spotlight";

  const rawWindow = getSingleParam(rawParams.window)?.trim();
  const window: NewsfeedWindow =
    rawWindow && VALID_WINDOW_SET.has(rawWindow)
      ? (rawWindow as NewsfeedWindow)
      : "30d";

  const rawCategory = getSingleParam(rawParams.category)?.trim();
  const category: CategorySlug | undefined =
    rawCategory && isValidCategory(rawCategory) ? rawCategory : undefined;

  const rawUsability = getSingleParam(rawParams.usability)?.trim();
  let usability: UsabilityLevel | undefined =
    rawUsability && VALID_USABILITY_SET.has(rawUsability)
      ? (rawUsability as UsabilityLevel)
      : undefined;

  if (tab === "ready" && usability === "dev-required") {
    usability = undefined;
  }

  const rawQuality = getSingleParam(rawParams.quality)?.trim();
  const quality: NewsfeedQualityFilter | undefined =
    rawQuality && VALID_QUALITY_SET.has(rawQuality)
      ? (rawQuality as NewsfeedQualityFilter)
      : undefined;

  return { tab, window, category, usability, quality };
}

/** Tạo URL `/newsfeed` sạch, tự động loại bỏ giá trị mặc định và tránh xung đột `ready` + `dev-required`. */
export function buildNewsfeedUrl(
  current: NewsfeedParams,
  updates: Partial<NewsfeedParams>,
): string {
  const merged: NewsfeedParams = { ...current, ...updates };

  if (merged.tab === "ready" && merged.usability === "dev-required") {
    merged.usability = undefined;
  }

  const params = new URLSearchParams();
  if (merged.tab !== "spotlight") {
    params.set("tab", merged.tab);
  }
  if (merged.window !== "30d") {
    params.set("window", merged.window);
  }
  if (merged.category) {
    params.set("category", merged.category);
  }
  if (merged.usability) {
    params.set("usability", merged.usability);
  }
  if (merged.quality) {
    params.set("quality", merged.quality);
  }

  const qs = params.toString();
  return qs ? `/newsfeed?${qs}` : "/newsfeed";
}

function matchesWindow(
  tool: NewsfeedToolRow,
  tab: NewsfeedTab,
  window: NewsfeedWindow,
  now: Date,
): boolean {
  if (window === "all") {
    return true;
  }
  const maxDays = window === "7d" ? 7 : 30;
  const dateField = tab === "fresh" ? tool.createdAt : tool.lastPushedAt;
  return diffDays(now, dateField) <= maxDays;
}

function matchesTabBase(
  tool: NewsfeedToolRow,
  tab: NewsfeedTab,
  now: Date,
): boolean {
  switch (tab) {
    case "spotlight":
      return true;
    case "fresh":
      return !isUncategorizedTool(tool);
    case "gems":
      return isHiddenGem(tool, now);
    case "alternatives":
      return getCleanReplaces(tool.replaces).length > 0;
    case "ready":
      return (
        !isUncategorizedTool(tool) &&
        (tool.usability === "app-ready" || tool.usability === "cli-tool")
      );
  }
}

interface InternalScored {
  tool: NewsfeedToolRow;
  radarScore: number;
  quality: QualityRating;
}

function filterForTab(
  scoredPool: readonly InternalScored[],
  tab: NewsfeedTab,
  window: NewsfeedWindow,
  category: CategorySlug | undefined,
  usability: UsabilityLevel | undefined,
  quality: NewsfeedQualityFilter | undefined,
  now: Date,
): InternalScored[] {
  const effectiveUsability =
    tab === "ready" && usability === "dev-required" ? undefined : usability;
  const minTier: QualityTier =
    quality === "top" ? 3 : quality === "high" ? 2 : 0;

  return scoredPool.filter((entry) => {
    const { tool } = entry;
    if (entry.quality.tier < minTier) {
      return false;
    }
    if (category && tool.category !== category) {
      return false;
    }
    if (effectiveUsability && tool.usability !== effectiveUsability) {
      return false;
    }
    if (!matchesTabBase(tool, tab, now)) {
      return false;
    }
    return matchesWindow(tool, tab, window, now);
  });
}

function sortTabResults(
  items: readonly InternalScored[],
  tab: NewsfeedTab,
): InternalScored[] {
  const sorted = [...items];

  switch (tab) {
    case "spotlight": {
      sorted.sort((a, b) =>
        b.radarScore !== a.radarScore
          ? b.radarScore - a.radarScore
          : b.tool.stars - a.tool.stars,
      );
      return selectDiverseTools(
        sorted,
        NEWSFEED_MAX_ITEMS,
        DEFAULT_MAX_PER_CATEGORY,
      );
    }

    case "fresh": {
      sorted.sort((a, b) => {
        const createdDiff =
          toTimestampMs(b.tool.createdAt) - toTimestampMs(a.tool.createdAt);
        return createdDiff !== 0 ? createdDiff : b.radarScore - a.radarScore;
      });
      return sorted.slice(0, NEWSFEED_MAX_ITEMS);
    }

    case "gems": {
      sorted.sort((a, b) =>
        b.radarScore !== a.radarScore
          ? b.radarScore - a.radarScore
          : toTimestampMs(b.tool.lastPushedAt) -
            toTimestampMs(a.tool.lastPushedAt),
      );
      return sorted.slice(0, NEWSFEED_MAX_ITEMS);
    }

    case "alternatives": {
      sorted.sort((a, b) => {
        const aReady = a.tool.usability === "app-ready" ? 1 : 0;
        const bReady = b.tool.usability === "app-ready" ? 1 : 0;
        if (bReady !== aReady) {
          return bReady - aReady;
        }
        return b.radarScore !== a.radarScore
          ? b.radarScore - a.radarScore
          : b.tool.stars - a.tool.stars;
      });
      return sorted.slice(0, NEWSFEED_MAX_ITEMS);
    }

    case "ready": {
      sorted.sort((a, b) =>
        b.radarScore !== a.radarScore
          ? b.radarScore - a.radarScore
          : b.tool.stars - a.tool.stars,
      );
      return sorted.slice(0, NEWSFEED_MAX_ITEMS);
    }
  }
}

/**
 * Tổng hợp toàn bộ dữ liệu cho trang `/newsfeed` từ danh sách công cụ thật trong Neon PostgreSQL.
 */
export function buildNewsfeedData(
  tools: readonly NewsfeedToolRow[],
  params: NewsfeedParams,
  now: Date = new Date(),
): NewsfeedData {
  const scoredPool: InternalScored[] = tools.map((tool) => ({
    tool,
    radarScore: computeRadarScore(tool, now),
    quality: computeQualityRating(tool, now),
  }));

  let newLast7Days = 0;
  let activeGems = 0;
  let topRatedCount = 0;
  for (const { tool, quality } of scoredPool) {
    if (diffDays(now, tool.createdAt) <= 7) {
      newLast7Days += 1;
    }
    if (isHiddenGem(tool, now)) {
      activeGems += 1;
    }
    if (quality.tier === 3) {
      topRatedCount += 1;
    }
  }

  let effectiveWindow: NewsfeedWindow = params.window;
  let didRelaxWindow = false;

  let activeMatched = filterForTab(
    scoredPool,
    params.tab,
    params.window,
    params.category,
    params.usability,
    params.quality,
    now,
  );

  if (activeMatched.length === 0 && params.window !== "all") {
    const relaxedMatched = filterForTab(
      scoredPool,
      params.tab,
      "all",
      params.category,
      params.usability,
      params.quality,
      now,
    );
    if (relaxedMatched.length > 0) {
      activeMatched = relaxedMatched;
      effectiveWindow = "all";
      didRelaxWindow = true;
    }
  }

  const orderedItems = sortTabResults(activeMatched, params.tab).map(
    (entry) => ({
      tool: entry.tool,
      radarScore: entry.radarScore,
      highlightBadge: buildNewsfeedHighlight(entry.tool, params.tab, now),
      quality: entry.quality,
    }),
  );

  const countTab = (tab: NewsfeedTab) =>
    filterForTab(
      scoredPool,
      tab,
      effectiveWindow,
      params.category,
      params.usability,
      params.quality,
      now,
    ).length;

  const tabCounts = {
    spotlight: countTab("spotlight"),
    fresh: countTab("fresh"),
    gems: countTab("gems"),
    alternatives: countTab("alternatives"),
    ready: countTab("ready"),
  } satisfies Record<NewsfeedTab, number>;

  return {
    params,
    effectiveWindow,
    didRelaxWindow,
    items: orderedItems,
    totalMatchedInTab: activeMatched.length,
    tabCounts,
    pulse: {
      newLast7Days,
      activeGems,
      totalTools: tools.length,
      topRatedCount,
    },
    toolkits: buildCuratedToolkits(tools, now),
  };
}
