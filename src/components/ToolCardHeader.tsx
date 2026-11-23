"use client";

import { ExternalLink, Pin, PinOff, Sparkles, Star } from "lucide-react";
import { formatStars } from "@/lib/ui-helpers";

export interface ToolCardHeaderProps {
  name: string;
  fullName: string;
  safeHtmlUrl: string;
  stars: number;
  isPinned: boolean;
  isSaving: boolean;
  highlightBadge?: string;
  onTogglePin: () => void;
}

/**
 * Phần đầu của `ToolCard`: nhãn nổi bật tùy chọn, tên repo kèm link GitHub, số sao và nút Ghim/Bỏ ghim.
 */
export function ToolCardHeader({
  name,
  fullName,
  safeHtmlUrl,
  stars,
  isPinned,
  isSaving,
  highlightBadge,
  onTogglePin,
}: ToolCardHeaderProps) {
  return (
    <>
      {highlightBadge && (
        <div className="flex items-center">
          <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
            <Sparkles className="h-3 w-3 shrink-0 text-emerald-400" />
            <span className="truncate">{highlightBadge}</span>
          </span>
        </div>
      )}

      {/* Header: Repo title, stars, pin */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="min-w-0 font-mono text-base font-semibold tracking-tight tabular-nums">
            <a
              href={safeHtmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex max-w-full items-center gap-1.5 rounded text-zinc-100 transition-colors hover:text-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              <span className="truncate">{name}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-colors group-hover:text-emerald-400" />
            </a>
          </h2>
          <p className="truncate font-mono text-xs tabular-nums text-zinc-400">
            {fullName}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <span
            title={`${stars.toLocaleString("vi-VN")} sao trên GitHub`}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950/80 px-2 py-1 font-mono text-xs tabular-nums text-amber-300"
          >
            <Star className="h-3.5 w-3.5 fill-amber-400/20 text-amber-400" />
            <span>{formatStars(stars)}</span>
          </span>

          <button
            type="button"
            onClick={onTogglePin}
            disabled={isSaving}
            aria-pressed={isPinned}
            aria-label={isPinned ? `Bỏ ghim ${name}` : `Ghim ${name}`}
            title={isPinned ? "Bỏ ghim công cụ" : "Ghim yêu thích"}
            className={`inline-flex cursor-pointer items-center justify-center rounded-md border p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50 ${
              isPinned
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                : "border-zinc-800 bg-zinc-950/80 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            }`}
          >
            {isPinned ? (
              <PinOff className="h-3.5 w-3.5" />
            ) : (
              <Pin className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    </>
  );
}
