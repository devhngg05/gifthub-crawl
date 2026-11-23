"use client";

import Link from "next/link";
import { Clock, Code2, Replace, Tag } from "lucide-react";
import { RelativeTime } from "@/components/RelativeTime";
import { SUB_CATEGORY_MAP, isValidSubCategory } from "@/config/taxonomy";
import type { ToolRow } from "@/db/schema";

const USABILITY_BADGES: Record<
  string,
  { label: string; className: string }
> = {
  "app-ready": {
    label: "Dùng ngay",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  },
  "cli-tool": {
    label: "CLI",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  },
  "dev-required": {
    label: "Cho Dev",
    className: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  },
};

function getSubCategoryLabel(slug: string): string {
  if (slug === "uncategorized") {
    return "Chưa phân loại";
  }
  if (isValidSubCategory(slug)) {
    return SUB_CATEGORY_MAP[slug].label;
  }
  return slug;
}

export interface ToolCardDetailsProps {
  tool: Omit<ToolRow, "searchText">;
  pushedIso: string;
  isNoteOpen: boolean;
}

/**
 * Hiển thị metadata, nhãn ngách chính/phụ, tóm tắt tiếng Việt, công dụng, phần mềm thay thế và bản xem trước ghi chú.
 */
export function ToolCardDetails({
  tool,
  pushedIso,
  isNoteOpen,
}: ToolCardDetailsProps) {
  const usabilityBadge = USABILITY_BADGES[tool.usability] ?? {
    label: tool.usability,
    className: "border-zinc-700 bg-zinc-800/70 text-zinc-300",
  };

  return (
    <>
      {/* Metadata row: Usability, language, pushedAt */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`inline-flex items-center rounded-md border px-2 py-0.5 font-medium ${usabilityBadge.className}`}
        >
          {usabilityBadge.label}
        </span>

        {tool.language && (
          <span className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950/70 px-2 py-0.5 font-mono text-zinc-300">
            <Code2 className="h-3 w-3 text-zinc-400" />
            <span>{tool.language}</span>
          </span>
        )}

        <span className="inline-flex items-center gap-1 text-zinc-400">
          <Clock className="h-3 w-3" />
          <RelativeTime isoDate={pushedIso} />
        </span>
      </div>

      {/* Primary + secondary subcategories */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Link
          href={`/?subCategory=${encodeURIComponent(tool.subCategory)}`}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
            tool.subCategory === "uncategorized"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
              : "border-zinc-700 bg-zinc-800/80 text-zinc-200 hover:border-emerald-500/40 hover:text-emerald-300"
          }`}
        >
          <Tag className="h-3 w-3" />
          <span>{getSubCategoryLabel(tool.subCategory)}</span>
        </Link>

        {tool.secondarySubCategories.map((sec) => (
          <Link
            key={sec}
            href={`/?subCategory=${encodeURIComponent(sec)}`}
            className="inline-flex items-center rounded-md border border-zinc-800 bg-zinc-950/80 px-2 py-0.5 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {getSubCategoryLabel(sec)}
          </Link>
        ))}
      </div>

      {/* Summary */}
      <p className="break-words text-sm leading-relaxed text-zinc-300 [overflow-wrap:anywhere]">
        {tool.summaryVi}
      </p>

      {/* Use cases */}
      {tool.useCases.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tool.useCases.map((useCase) => (
            <span
              key={useCase}
              className="rounded-md bg-zinc-800/60 px-2 py-0.5 text-xs text-zinc-300"
            >
              {useCase}
            </span>
          ))}
        </div>
      )}

      {/* Replaces */}
      {tool.replaces.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
          <span className="inline-flex items-center gap-1 text-zinc-400">
            <Replace className="h-3 w-3" />
            <span>Thay thế cho:</span>
          </span>
          {tool.replaces.map((software) => (
            <span
              key={software}
              className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300"
            >
              {software}
            </span>
          ))}
        </div>
      )}

      {/* Existing user note preview */}
      {tool.userNotes && !isNoteOpen && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-100/90">
          <p className="mb-0.5 font-medium text-emerald-400">
            Ghi chú cá nhân:
          </p>
          <p className="whitespace-pre-wrap break-words text-zinc-300 [overflow-wrap:anywhere]">
            {tool.userNotes}
          </p>
        </div>
      )}
    </>
  );
}
