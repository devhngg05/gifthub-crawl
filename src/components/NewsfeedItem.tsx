import Link from "next/link";
import { ArrowUpRight, Star } from "lucide-react";
import { QualityStars } from "@/components/QualityStars";
import { RelativeTime } from "@/components/RelativeTime";
import { SUB_CATEGORY_MAP, isValidSubCategory } from "@/config/taxonomy";
import type { ScoredNewsfeedTool } from "@/lib/newsfeed";
import { formatStars, getSafeExternalUrl } from "@/lib/ui-helpers";

export interface NewsfeedItemProps {
  item: ScoredNewsfeedTool;
}

function extractOwner(fullName: string): string | null {
  const slashIndex = fullName.indexOf("/");
  if (slashIndex <= 0) {
    return null;
  }
  return fullName.slice(0, slashIndex);
}

function normalizeContextHighlight(highlightBadge: string): string | null {
  if (!highlightBadge || highlightBadge === "Đang rất nổi bật") {
    return null;
  }
  if (highlightBadge === "Dùng ngay") {
    return "Cài là dùng ngay";
  }
  return highlightBadge;
}

/**
 * Một dòng tin tối giản trên `/newsfeed` gồm đúng 3 lớp thông tin:
 * Định danh & Ngôi sao chất lượng, Mô tả tiếng Việt gọn, và Ngữ cảnh mờ.
 */
export function NewsfeedItem({ item }: NewsfeedItemProps) {
  const { tool, quality, highlightBadge } = item;
  const safeUrl = getSafeExternalUrl(tool.htmlUrl);
  const owner = extractOwner(tool.fullName);
  const subCategoryLabel = isValidSubCategory(tool.subCategory)
    ? SUB_CATEGORY_MAP[tool.subCategory].label
    : "Chưa phân loại";
  const contextHighlight = normalizeContextHighlight(highlightBadge);
  const pushedIso =
    tool.lastPushedAt instanceof Date
      ? tool.lastPushedAt.toISOString()
      : String(tool.lastPushedAt);

  return (
    <article className="px-3 py-4 transition-colors hover:bg-zinc-900/50 sm:px-4">
      {/* Dòng 1: Định danh & Tín hiệu chất lượng */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <QualityStars rating={quality} size="sm" />
          <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 truncate text-base font-semibold tracking-tight text-zinc-100 transition-colors hover:text-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {tool.name}
          </a>
          {owner && (
            <span className="hidden shrink-0 font-mono text-xs text-zinc-500 sm:inline">
              {owner}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-zinc-400"
            title={`${tool.stars.toLocaleString("vi-VN")} sao GitHub`}
          >
            <Star className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
            <span>{formatStars(tool.stars)}</span>
          </span>

          <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Mở ${tool.fullName} trên GitHub`}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            <span>GitHub</span>
            <ArrowUpRight className="h-3 w-3 text-zinc-400" aria-hidden="true" />
          </a>

          <Link
            href={`/?q=${encodeURIComponent(tool.fullName)}`}
            className="inline-flex items-center rounded-md border border-zinc-800/80 px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            Chi tiết
          </Link>
        </div>
      </div>

      {/* Dòng 2: Nội dung cốt lõi */}
      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-zinc-300">
        {tool.summaryVi}
      </p>

      {/* Dòng 3: Ngữ cảnh siêu sạch (tối đa 3 mẩu mờ) */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
        <span className="text-zinc-400">{subCategoryLabel}</span>
        {contextHighlight && (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-zinc-400">{contextHighlight}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <RelativeTime isoDate={pushedIso} className="text-zinc-500" />
      </div>
    </article>
  );
}
