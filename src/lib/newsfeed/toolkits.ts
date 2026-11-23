import type { CategorySlug, SubCategorySlug } from "@/config/taxonomy";
import { computeQualityRating, type QualityRating } from "./quality";
import {
  computeRadarScore,
  isUncategorizedTool,
  type NewsfeedToolRow,
} from "./scoring";

export type ToolkitAccent =
  | "emerald"
  | "sky"
  | "amber"
  | "violet"
  | "rose"
  | "cyan";

export interface CuratedToolkitTool {
  tool: NewsfeedToolRow;
  quality: QualityRating;
}

export interface CuratedToolkit {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  accent: ToolkitAccent;
  targetCategory: CategorySlug;
  totalMatchedCount: number;
  tools: NewsfeedToolRow[];
  ratedTools: CuratedToolkitTool[];
}

interface ToolkitBlueprint {
  readonly id: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly description: string;
  readonly accent: ToolkitAccent;
  readonly targetCategory: CategorySlug;
  readonly subCategories: readonly SubCategorySlug[];
}

const TOOLKIT_BLUEPRINTS: readonly ToolkitBlueprint[] = [
  {
    id: "local-ai-coding",
    title: "Bộ AI Cục bộ & Lập trình",
    shortTitle: "AI Cục bộ",
    description:
      "Chạy LLM cục bộ, giao diện chat đa model, trợ lý viết code và MCP workflow.",
    accent: "emerald",
    targetCategory: "ai-llm",
    subCategories: [
      "local-llm-gateway",
      "ai-chat-ui",
      "ai-coding-agent",
      "ai-workflow-mcp",
    ],
  },
  {
    id: "api-automation",
    title: "Bộ Nối API & Tự động hóa",
    shortTitle: "Nối API & Auto",
    description:
      "Nối API, bắt webhook, test endpoint, dựng luồng workflow và cào dữ liệu tự động.",
    accent: "sky",
    targetCategory: "automation-scraping",
    subCategories: [
      "api-gateway-webhook",
      "workflow-orchestration",
      "api-client-testing",
      "web-scraping-browser",
    ],
  },
  {
    id: "selfhost-homelab",
    title: "Bộ Self-host & Homelab",
    shortTitle: "Self-host",
    description:
      "Tự triển khai VPS/Docker, quản trị container, mạng VPN riêng và đồng bộ file.",
    accent: "amber",
    targetCategory: "infra-security",
    subCategories: [
      "self-host-deploy",
      "containers-homelab",
      "network-proxy-vpn",
      "file-sync-share",
    ],
  },
  {
    id: "security-privacy",
    title: "Bộ Bảo mật & Quyền riêng tư",
    shortTitle: "Bảo mật",
    description:
      "Quản lý mật khẩu/secrets, quét lỗ hổng, tường lửa phòng thủ và giao tiếp mã hóa.",
    accent: "rose",
    targetCategory: "security-privacy",
    subCategories: [
      "security-vault",
      "pentest-vuln-scanner",
      "firewall-siem-defense",
      "privacy-encryption-comms",
    ],
  },
  {
    id: "productivity-knowledge",
    title: "Bộ Năng suất & Tri thức cá nhân",
    shortTitle: "Năng suất",
    description:
      "Ghi chú second brain, quản lý công việc, đọc tin RSS/bookmark và tiện ích máy.",
    accent: "violet",
    targetCategory: "productivity-os",
    subCategories: [
      "pkm-study-notes",
      "task-project-management",
      "rss-bookmarks-reading",
      "os-desktop-utility",
    ],
  },
  {
    id: "data-bi-creative",
    title: "Bộ Dữ liệu, BI & Sáng tạo",
    shortTitle: "Dữ liệu & Media",
    description:
      "Dashboard BI, luồng dữ liệu ETL cùng bộ công cụ xử lý video, âm thanh và ảnh/SVG.",
    accent: "cyan",
    targetCategory: "data-analytics",
    subCategories: [
      "bi-analytics-dashboard",
      "data-pipeline-etl",
      "video-audio-tools",
      "image-svg-tools",
    ],
  },
] as const;

/**
 * Tự động lắp ghép các Bộ công cụ thực chiến từ dữ liệu thật theo ngách `subCategory`
 * (ưu tiên đa dạng ngách con trong cùng một bộ và ẩn hoàn toàn bộ có dưới 2 công cụ).
 */
export function buildCuratedToolkits(
  tools: readonly NewsfeedToolRow[],
  now: Date,
): CuratedToolkit[] {
  if (tools.length === 0) {
    return [];
  }

  const scoreCache = new Map<number, number>();
  const getScore = (tool: NewsfeedToolRow): number => {
    const cached = scoreCache.get(tool.id);
    if (cached !== undefined) {
      return cached;
    }
    const score = computeRadarScore(tool, now);
    scoreCache.set(tool.id, score);
    return score;
  };

  const toolkits: CuratedToolkit[] = [];

  for (const blueprint of TOOLKIT_BLUEPRINTS) {
    const subSet = new Set<string>(blueprint.subCategories);
    const matched = tools.filter(
      (tool) =>
        !isUncategorizedTool(tool) &&
        (subSet.has(tool.subCategory) ||
          tool.secondarySubCategories.some((sec) => subSet.has(sec))),
    );

    if (matched.length < 2) {
      continue;
    }

    const sortedMatched = [...matched].sort((a, b) => {
      const scoreDiff = getScore(b) - getScore(a);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      if (b.stars !== a.stars) {
        return b.stars - a.stars;
      }
      return a.id - b.id;
    });

    const picked: NewsfeedToolRow[] = [];
    const pickedIds = new Set<number>();
    const coveredSubs = new Set<string>();

    // Vòng 1: ưu tiên chọn tối đa 1 công cụ cao điểm nhất cho mỗi ngách con trong bộ
    for (const tool of sortedMatched) {
      if (picked.length >= 4) {
        break;
      }
      const candidates: string[] = [];
      if (subSet.has(tool.subCategory)) {
        candidates.push(tool.subCategory);
      }
      for (const sec of tool.secondarySubCategories) {
        if (subSet.has(sec) && !candidates.includes(sec)) {
          candidates.push(sec);
        }
      }
      const uncovered = candidates.find((sub) => !coveredSubs.has(sub));
      if (uncovered) {
        picked.push(tool);
        pickedIds.add(tool.id);
        coveredSubs.add(uncovered);
      }
    }

    // Vòng 2: bổ sung theo điểm nếu số ngách con hiện có chưa đủ 4 công cụ
    for (const tool of sortedMatched) {
      if (picked.length >= 4) {
        break;
      }
      if (!pickedIds.has(tool.id)) {
        picked.push(tool);
        pickedIds.add(tool.id);
      }
    }

    toolkits.push({
      id: blueprint.id,
      title: blueprint.title,
      shortTitle: blueprint.shortTitle,
      description: blueprint.description,
      accent: blueprint.accent,
      targetCategory: blueprint.targetCategory,
      totalMatchedCount: matched.length,
      tools: picked,
      ratedTools: picked.map((tool) => ({
        tool,
        quality: computeQualityRating(tool, now),
      })),
    });
  }

  return toolkits;
}
