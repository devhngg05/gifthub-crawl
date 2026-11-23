"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Loader2,
  StickyNote,
} from "lucide-react";
import { AdminSecretModal } from "@/components/AdminSecretModal";
import { ToolCardDetails } from "@/components/ToolCardDetails";
import { ToolCardHeader } from "@/components/ToolCardHeader";
import { ToolNoteEditor } from "@/components/ToolNoteEditor";
import {
  SUB_CATEGORY_MAP,
  TAXONOMY,
  isValidSubCategory,
} from "@/config/taxonomy";
import type { ToolRow } from "@/db/schema";
import { useToolMutations } from "@/hooks/useToolMutations";
import { getSafeExternalUrl } from "@/lib/ui-helpers";

export interface ToolCardProps {
  tool: Omit<ToolRow, "searchText">;
  highlightBadge?: string;
}

/**
 * Thẻ hiển thị thông tin công cụ từ Neon PostgreSQL cùng 3 tương tác cá nhân hóa:
 * Ghim (`isPinned`), Ghi chú (`userNotes`), Phân loại lại (`subCategory`) qua `PATCH /api/tools/[id]`.
 */
export function ToolCard({ tool, highlightBadge }: ToolCardProps) {
  const {
    isSaving,
    errorMessage,
    isNoteOpen,
    notesDraft,
    setNotesDraft,
    pendingPatch,
    modalError,
    handleTogglePin,
    handleSubCategoryChange,
    handleSaveNotes,
    handleClearNotes,
    handleAdminSecretSubmit,
    closeAdminModal,
    cancelNotes,
    toggleNoteOpen,
  } = useToolMutations(tool);

  const [isSubMenuOpen, setIsSubMenuOpen] = useState(false);
  const subMenuRef = useRef<HTMLDivElement>(null);
  const subTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isSubMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (subMenuRef.current && target && !subMenuRef.current.contains(target)) {
        setIsSubMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsSubMenuOpen(false);
        subTriggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSubMenuOpen]);

  const pushedIso =
    tool.lastPushedAt instanceof Date
      ? tool.lastPushedAt.toISOString()
      : String(tool.lastPushedAt);

  const safeHtmlUrl = getSafeExternalUrl(tool.htmlUrl);
  const currentSubLabel = isValidSubCategory(tool.subCategory)
    ? SUB_CATEGORY_MAP[tool.subCategory].label
    : "Chưa phân loại";

  return (
    <>
      <article
        className={`relative flex min-w-0 flex-col justify-between rounded-xl border bg-zinc-900/60 p-5 transition-colors ${
          isSubMenuOpen ? "z-30" : ""
        } ${
          tool.isPinned
            ? "border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]"
            : "border-zinc-800 hover:border-zinc-700"
        }`}
      >
        <div className="min-w-0 space-y-3.5">
          <ToolCardHeader
            name={tool.name}
            fullName={tool.fullName}
            safeHtmlUrl={safeHtmlUrl}
            stars={tool.stars}
            isPinned={tool.isPinned}
            isSaving={isSaving}
            highlightBadge={highlightBadge}
            onTogglePin={handleTogglePin}
          />

          <ToolCardDetails
            tool={tool}
            pushedIso={pushedIso}
            isNoteOpen={isNoteOpen}
          />
        </div>

        {/* Footer controls */}
        <div className="mt-4 space-y-2.5 border-t border-zinc-800/80 pt-3">
          {errorMessage && (
            <div
              role="alert"
              className="flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Re-categorize dark dropdown */}
            <div ref={subMenuRef} className="relative min-w-0 flex-1">
              <button
                ref={subTriggerRef}
                id={`subcat-${tool.id}`}
                type="button"
                disabled={isSaving}
                aria-haspopup="listbox"
                aria-expanded={isSubMenuOpen}
                aria-controls={`subcat-listbox-${tool.id}`}
                aria-label={`Phân loại lại ${tool.name}`}
                onClick={() => setIsSubMenuOpen((prev) => !prev)}
                className={`inline-flex w-full max-w-[230px] cursor-pointer items-center justify-between gap-2 rounded-md border bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-50 ${
                  isSubMenuOpen ? "border-emerald-500/60" : "border-zinc-800"
                }`}
              >
                <span className="truncate">{currentSubLabel}</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${
                    isSubMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isSubMenuOpen && (
                <div
                  id={`subcat-listbox-${tool.id}`}
                  role="listbox"
                  aria-label={`Chọn ngách cho ${tool.name}`}
                  className="absolute bottom-full left-0 z-50 mb-1.5 max-h-72 w-64 max-w-[calc(100vw-3rem)] overflow-y-auto overscroll-contain rounded-lg border border-zinc-700 bg-zinc-950 p-1.5 shadow-2xl"
                >
                  {TAXONOMY.map((cat) => (
                    <div
                      key={cat.slug}
                      role="group"
                      aria-label={cat.label}
                      className="py-1 first:pt-0 last:pb-0"
                    >
                      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        {cat.label}
                      </p>
                      <div className="space-y-0.5">
                        {cat.subCategories.map((sub) => {
                          const isSelected = tool.subCategory === sub.slug;
                          return (
                            <button
                              key={sub.slug}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              disabled={isSaving}
                              onClick={() => {
                                setIsSubMenuOpen(false);
                                void handleSubCategoryChange(sub.slug);
                              }}
                              className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                                isSelected
                                  ? "bg-emerald-500/15 font-medium text-emerald-300"
                                  : "text-zinc-200 hover:bg-zinc-900 hover:text-white"
                              }`}
                            >
                              <span className="truncate">{sub.label}</span>
                              {isSelected && (
                                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isSaving && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Đang lưu...</span>
                </span>
              )}

              <button
                type="button"
                disabled={isSaving}
                aria-expanded={isNoteOpen}
                onClick={toggleNoteOpen}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50"
              >
                <StickyNote className="h-3.5 w-3.5 text-emerald-400" />
                <span>{tool.userNotes ? "Sửa ghi chú" : "Ghi chú"}</span>
              </button>
            </div>
          </div>

          {isNoteOpen && (
            <ToolNoteEditor
              toolName={tool.name}
              notesDraft={notesDraft}
              hasExistingNote={Boolean(tool.userNotes)}
              isSaving={isSaving}
              onNotesDraftChange={setNotesDraft}
              onSave={handleSaveNotes}
              onClear={handleClearNotes}
              onCancel={cancelNotes}
            />
          )}
        </div>
      </article>

      <AdminSecretModal
        open={pendingPatch !== null}
        titleId={`admin-modal-title-${tool.id}`}
        isSaving={isSaving}
        errorMessage={modalError}
        onClose={closeAdminModal}
        onSubmit={handleAdminSecretSubmit}
      />
    </>
  );
}
