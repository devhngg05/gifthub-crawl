import { formatStars } from "@/lib/ui-helpers";
import {
  computeScoreComponents,
  diffDays,
  getCleanReplaces,
  isHiddenGem,
  isUncategorizedTool,
  type NewsfeedToolRow,
} from "./scoring";

export type NewsfeedTab =
  | "spotlight"
  | "fresh"
  | "gems"
  | "alternatives"
  | "ready";

export type QualityTier = 0 | 1 | 2 | 3;

export interface QualityRating {
  tier: QualityTier;
  label: string;
  reasons: string[];
}

const MAX_REPLACE_BADGE_NAME_LEN = 22;

function formatReplaceBadge(name: string): string {
  const trimmed = name.trim();
  const shortName =
    trimmed.length > MAX_REPLACE_BADGE_NAME_LEN
      ? `${trimmed.slice(0, MAX_REPLACE_BADGE_NAME_LEN).trimEnd()}…`
      : trimmed;
  return `Thay thế ${shortName}`;
}

/**
 * Đánh giá hệ thống Ngôi sao chất lượng (0–3 sao) dựa trên điểm nội tại tại `now`,
 * tách biệt với số sao GitHub thô và chống lạm phát sao với repo chưa phân loại hoặc ngừng cập nhật.
 */
export function computeQualityRating(
  tool: NewsfeedToolRow,
  now: Date,
): QualityRating {
  if (isUncategorizedTool(tool)) {
    return { tier: 0, label: "", reasons: [] };
  }

  const { rawIntrinsic, pushedDays } = computeScoreComponents(tool, now);
  const intrinsicScore = Math.round(rawIntrinsic * 100) / 100;
  const cleanReplaces = getCleanReplaces(tool.replaces);
  const hasReplaces = cleanReplaces.length > 0;

  let tier: QualityTier = 0;
  let label = "";

  if (
    intrinsicScore >= 92 &&
    pushedDays <= 30 &&
    (tool.stars >= 3000 ||
      (tool.stars >= 1000 && (tool.usability === "app-ready" || hasReplaces)))
  ) {
    tier = 3;
    label = "Xuất sắc";
  } else if (intrinsicScore >= 72 && pushedDays <= 90) {
    tier = 2;
    label = "Chất lượng cao";
  } else if (intrinsicScore >= 55) {
    tier = 1;
    label = "Đáng chú ý";
  }

  if (tier === 0) {
    return { tier: 0, label: "", reasons: [] };
  }

  const reasons: string[] = [`${formatStars(tool.stars)} sao GitHub`];

  if (Number.isFinite(pushedDays) && pushedDays <= 90) {
    const roundedDays = Math.floor(pushedDays);
    reasons.push(
      roundedDays === 0
        ? "Cập nhật hôm nay"
        : `Cập nhật ${roundedDays} ngày trước`,
    );
  }

  if (hasReplaces) {
    reasons.push(formatReplaceBadge(cleanReplaces[0]));
  }

  if (reasons.length < 3) {
    if (tool.usability === "app-ready") {
      reasons.push("Cài là dùng ngay");
    } else if (tool.usability === "cli-tool") {
      reasons.push("CLI tiện lợi");
    }
  }

  if (reasons.length < 2) {
    reasons.push(`Điểm chất lượng ${Math.round(intrinsicScore)}`);
  }

  return {
    tier,
    label,
    reasons: reasons.slice(0, 3),
  };
}

/**
 * Tạo 1 nhãn lý do tiếng Việt ngắn gọn giải thích vì sao công cụ nổi bật ở luồng hiện tại.
 */
export function buildNewsfeedHighlight(
  tool: NewsfeedToolRow,
  tab: NewsfeedTab,
  now: Date,
): string {
  const firstReplace = getCleanReplaces(tool.replaces)[0];
  const pushedDays = diffDays(now, tool.lastPushedAt);
  const createdDays = diffDays(now, tool.createdAt);

  if (tab === "alternatives" && firstReplace) {
    return formatReplaceBadge(firstReplace);
  }
  if (tab === "gems") {
    return "Tiềm năng";
  }
  if (tab === "fresh") {
    return createdDays <= 7 ? "Mới vào radar" : "Mới cập nhật";
  }
  if (tab === "ready") {
    return tool.usability === "cli-tool" ? "CLI dùng ngay" : "Dùng ngay";
  }

  if (firstReplace) {
    return formatReplaceBadge(firstReplace);
  }
  if (createdDays <= 3) {
    return "Mới vào radar";
  }
  if (isHiddenGem(tool, now)) {
    return "Tiềm năng";
  }
  if (pushedDays <= 7) {
    return "Vừa cập nhật";
  }
  if (tool.usability === "app-ready") {
    return "Dùng ngay";
  }
  return "Đang rất nổi bật";
}
