"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronUp, Star } from "lucide-react";
import { QualityStars } from "@/components/QualityStars";
import type { CuratedToolkit } from "@/lib/newsfeed";
import { formatStars, getSafeExternalUrl } from "@/lib/ui-helpers";

export interface ToolkitShowcaseProps {
  toolkits: readonly CuratedToolkit[];
}

/**
 * Hiển thị khu vực Bộ công cụ tuyển chọn dạng 1 thanh chọn ngang gọn nhẹ,
 * chỉ mở rộng 1 bộ đang chọn gồm tối đa 4 công cụ tinh hoa nhất.
 */
export function ToolkitShowcase({ toolkits }: ToolkitShowcaseProps) {
  const [activeId, setActiveId] = useState<string>(toolkits[0]?.id ?? "");
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (toolkits.length === 0) {
    return null;
  }

  const activeKit =
    toolkits.find((kit) => kit.id === activeId) ?? toolkits[0];

  if (!activeKit) {
    return null;
  }

  return (
    <section
      aria-labelledby="toolkit-showcase-heading"
      className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3 sm:p-4"
    >
      {/* Thanh trên: Tiêu đề + 6 nút chuyển ngang + nút Thu gọn */}
      <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center justify-between gap-2">
          <h2
            id="toolkit-showcase-heading"
            className="shrink-0 text-xs font-semibold uppercase tracking-wider text-zinc-400"
          >
            Bộ công cụ tuyển chọn
          </h2>

          <button
            type="button"
            aria-expanded={!isCollapsed}
            aria-controls="toolkit-showcase-panel"
            onClick={() => setIsCollapsed((prev) => !prev)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 md:hidden"
          >
            <span>{isCollapsed ? "Mở rộng" : "Thu gọn"}</span>
            {isCollapsed ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <div
            role="tablist"
            aria-label="Chọn bộ công cụ"
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5 md:pb-0"
          >
            {toolkits.map((kit) => {
              const isSelected = kit.id === activeKit.id;
              return (
                <button
                  key={kit.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => {
                    setActiveId(kit.id);
                    if (isCollapsed) {
                      setIsCollapsed(false);
                    }
                  }}
                  className={`shrink-0 cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                    isSelected
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                  }`}
                >
                  {kit.shortTitle}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            aria-expanded={!isCollapsed}
            aria-controls="toolkit-showcase-panel"
            onClick={() => setIsCollapsed((prev) => !prev)}
            className="hidden shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 md:inline-flex"
          >
            <span>{isCollapsed ? "Mở rộng" : "Thu gọn"}</span>
            {isCollapsed ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Nội dung 1 bộ đang chọn */}
      {!isCollapsed && (
        <div id="toolkit-showcase-panel" className="mt-3 space-y-2.5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {activeKit.ratedTools.map(({ tool, quality }) => {
              const safeUrl = getSafeExternalUrl(tool.htmlUrl);
              return (
                <div
                  key={tool.id}
                  className="min-w-0 rounded-lg border border-zinc-800/70 bg-zinc-950/60 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <QualityStars rating={quality} size="xs" />
                      <a
                        href={safeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 truncate font-mono text-xs font-semibold text-zinc-100 transition-colors hover:text-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                      >
                        {tool.name}
                      </a>
                    </div>

                    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums text-zinc-400">
                      <Star
                        className="h-3 w-3 text-zinc-500"
                        aria-hidden="true"
                      />
                      <span>{formatStars(tool.stars)}</span>
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-xs text-zinc-400">
                    {tool.summaryVi}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 text-xs">
            <p className="hidden truncate text-zinc-500 sm:block">
              {activeKit.description}
            </p>
            <Link
              href={`/?category=${encodeURIComponent(activeKit.targetCategory)}`}
              className="ml-auto inline-flex shrink-0 items-center gap-1 font-medium text-emerald-400 transition-colors hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              <span>Xem toàn bộ nhóm</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
