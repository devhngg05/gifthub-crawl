"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Clock,
  Code2,
  ExternalLink,
  KeyRound,
  Loader2,
  Pin,
  PinOff,
  Replace,
  Save,
  StickyNote,
  Tag,
  Trash2,
  X,
  Star,
} from "lucide-react";
import {
  SUB_CATEGORY_MAP,
  TAXONOMY,
  isValidSubCategory,
  type SubCategorySlug,
} from "@/config/taxonomy";
import type { ToolRow } from "@/db/schema";
import { formatStars } from "@/lib/ui-helpers";
import type { ToolPatchInput } from "@/lib/validator";
import { RelativeTime } from "@/components/RelativeTime";

export interface ToolCardProps {
  tool: ToolRow;
}

const ADMIN_SECRET_STORAGE_KEY = "gtr_admin_secret";

const USABILITY_BADGES: Record<
  string,
  { label: string; className: string }
> = {
  "app-ready": {
    label: "Dùng ngay",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  },
  "cli-tool": {
    label: "CLI Tool",
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

function readStoredAdminSecret(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage.getItem(ADMIN_SECRET_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveStoredAdminSecret(secret: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(ADMIN_SECRET_STORAGE_KEY, secret);
  } catch {
    // Ignore storage restriction errors
  }
}

function clearStoredAdminSecret(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(ADMIN_SECRET_STORAGE_KEY);
  } catch {
    // Ignore storage restriction errors
  }
}

/**
 * Thẻ hiển thị thông tin công cụ từ Neon PostgreSQL cùng 3 tương tác cá nhân hóa:
 * Ghim (`isPinned`), Ghi chú (`userNotes`), Phân loại lại (`subCategory`) qua `PATCH /api/tools/[id]`.
 */
export function ToolCard({ tool }: ToolCardProps) {
  const router = useRouter();

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(tool.userNotes ?? "");
  const [prevUserNotes, setPrevUserNotes] = useState(tool.userNotes);

  if (tool.userNotes !== prevUserNotes) {
    setPrevUserNotes(tool.userNotes);
    setNotesDraft(tool.userNotes ?? "");
  }

  // Admin secret modal state (only shown when server returns 401)
  const [pendingPatch, setPendingPatch] = useState<ToolPatchInput | null>(null);
  const [adminSecretInput, setAdminSecretInput] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);

  const pushedIso =
    tool.lastPushedAt instanceof Date
      ? tool.lastPushedAt.toISOString()
      : String(tool.lastPushedAt);

  const usabilityBadge = USABILITY_BADGES[tool.usability] ?? {
    label: tool.usability,
    className: "border-zinc-700 bg-zinc-800/70 text-zinc-300",
  };

  async function submitPatch(
    payload: ToolPatchInput,
    overrideSecret?: string,
  ): Promise<boolean> {
    setIsSaving(true);
    setErrorMessage(null);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const secret = overrideSecret ?? readStoredAdminSecret();
    if (secret) {
      headers["x-admin-secret"] = secret;
    }

    try {
      const response = await fetch(`/api/tools/${tool.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        clearStoredAdminSecret();
        setPendingPatch(payload);
        if (overrideSecret !== undefined) {
          setModalError("Admin Secret không đúng, vui lòng kiểm tra lại.");
        } else {
          setModalError(null);
        }
        return false;
      }

      if (!response.ok) {
        let serverError = `Lỗi cập nhật (HTTP ${response.status})`;
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) {
            serverError = body.error;
          }
        } catch {
          // Fallback to status message
        }
        setErrorMessage(serverError);
        return false;
      }

      if (overrideSecret) {
        saveStoredAdminSecret(overrideSecret);
      }

      setPendingPatch(null);
      setModalError(null);
      setAdminSecretInput("");
      router.refresh();
      return true;
    } catch {
      setErrorMessage("Không thể kết nối tới máy chủ, vui lòng thử lại.");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTogglePin() {
    await submitPatch({ isPinned: !tool.isPinned });
  }

  async function handleSubCategoryChange(nextValue: string) {
    if (!isValidSubCategory(nextValue) || nextValue === tool.subCategory) {
      return;
    }
    await submitPatch({ subCategory: nextValue as SubCategorySlug });
  }

  async function handleSaveNotes() {
    const trimmed = notesDraft.trim();
    const ok = await submitPatch({
      userNotes: trimmed.length > 0 ? trimmed : null,
    });
    if (ok) {
      setIsNoteOpen(false);
    }
  }

  async function handleClearNotes() {
    const ok = await submitPatch({ userNotes: null });
    if (ok) {
      setNotesDraft("");
      setIsNoteOpen(false);
    }
  }

  async function handleAdminSecretSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingPatch) {
      return;
    }
    const trimmedSecret = adminSecretInput.trim();
    if (!trimmedSecret) {
      setModalError("Vui lòng nhập Admin Secret.");
      return;
    }
    const ok = await submitPatch(pendingPatch, trimmedSecret);
    if (ok && "userNotes" in pendingPatch) {
      setIsNoteOpen(false);
    }
  }

  return (
    <>
      <article
        className={`flex flex-col justify-between rounded-xl border bg-zinc-900/60 p-5 transition-colors ${
          tool.isPinned
            ? "border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]"
            : "border-zinc-800 hover:border-zinc-700"
        }`}
      >
        <div className="space-y-3.5">
          {/* Header: Repo title, stars, pin */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <a
                href={tool.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex max-w-full items-center gap-1.5 text-base font-semibold text-zinc-100 transition-colors hover:text-emerald-400"
              >
                <span className="truncate">{tool.name}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-500 transition-colors group-hover:text-emerald-400" />
              </a>
              <p className="truncate font-mono text-xs text-zinc-500">
                {tool.fullName}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <span
                title={`${tool.stars.toLocaleString("en-US")} sao trên GitHub`}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950/80 px-2 py-1 text-xs font-mono text-amber-300"
              >
                <Star className="h-3.5 w-3.5 fill-amber-400/20 text-amber-400" />
                <span>{formatStars(tool.stars)}</span>
              </span>

              <button
                type="button"
                onClick={handleTogglePin}
                disabled={isSaving}
                aria-pressed={tool.isPinned}
                title={tool.isPinned ? "Bỏ ghim công cụ" : "Ghim yêu thích"}
                className={`inline-flex items-center justify-center rounded-md border p-1.5 transition-colors disabled:opacity-50 ${
                  tool.isPinned
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                    : "border-zinc-800 bg-zinc-950/80 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                }`}
              >
                {tool.isPinned ? (
                  <PinOff className="h-3.5 w-3.5" />
                ) : (
                  <Pin className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Metadata row: Usability, language, pushedAt */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 font-medium ${usabilityBadge.className}`}
            >
              {usabilityBadge.label}
            </span>

            {tool.language && (
              <span className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950/70 px-2 py-0.5 font-mono text-zinc-300">
                <Code2 className="h-3 w-3 text-zinc-500" />
                <span>{tool.language}</span>
              </span>
            )}

            <span className="inline-flex items-center gap-1 text-zinc-500">
              <Clock className="h-3 w-3" />
              <RelativeTime isoDate={pushedIso} />
            </span>
          </div>

          {/* Primary + secondary subcategories */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={`/?subCategory=${encodeURIComponent(tool.subCategory)}`}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
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
                className="inline-flex items-center rounded-md border border-zinc-800 bg-zinc-950/80 px-2 py-0.5 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
              >
                {getSubCategoryLabel(sec)}
              </Link>
            ))}
          </div>

          {/* Summary */}
          <p className="text-sm leading-relaxed text-zinc-300">
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
              <span className="inline-flex items-center gap-1 text-zinc-500">
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
              <p className="whitespace-pre-wrap break-words text-zinc-300">
                {tool.userNotes}
              </p>
            </div>
          )}
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
            {/* Re-categorize select */}
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <label
                htmlFor={`subcat-${tool.id}`}
                className="sr-only"
              >
                Phân loại lại ngách cho {tool.name}
              </label>
              <select
                id={`subcat-${tool.id}`}
                value={tool.subCategory}
                disabled={isSaving}
                onChange={(e) => handleSubCategoryChange(e.target.value)}
                aria-label={`Phân loại lại ${tool.name}`}
                className="w-full max-w-[210px] rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 focus:border-emerald-500/60 focus:outline-none disabled:opacity-50"
              >
                {tool.subCategory === "uncategorized" && (
                  <option value="uncategorized" disabled>
                    Chưa phân loại
                  </option>
                )}
                {TAXONOMY.map((cat) => (
                  <optgroup key={cat.slug} label={cat.label}>
                    {cat.subCategories.map((sub) => (
                      <option key={sub.slug} value={sub.slug}>
                        {sub.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
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
                onClick={() => setIsNoteOpen((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
              >
                <StickyNote className="h-3.5 w-3.5 text-emerald-400" />
                <span>{tool.userNotes ? "Sửa ghi chú" : "Ghi chú"}</span>
              </button>
            </div>
          </div>

          {/* Inline note editor */}
          {isNoteOpen && (
            <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Nhập ghi chú cá nhân cho công cụ này..."
                aria-label={`Ghi chú cá nhân cho ${tool.name}`}
                className="w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500/60 focus:outline-none"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-zinc-500">
                  {notesDraft.length}/2000
                </span>
                <div className="flex items-center gap-1.5">
                  {tool.userNotes && (
                    <button
                      type="button"
                      onClick={handleClearNotes}
                      disabled={isSaving}
                      className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Xóa</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setNotesDraft(tool.userNotes ?? "");
                      setIsNoteOpen(false);
                    }}
                    disabled={isSaving}
                    className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveNotes}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <Save className="h-3 w-3" />
                    <span>Lưu</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </article>

      {/* Admin Secret Modal when PATCH receives HTTP 401 */}
      {pendingPatch !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`admin-modal-title-${tool.id}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-zinc-100">
                <KeyRound className="h-4 w-4 text-emerald-400" />
                <h2
                  id={`admin-modal-title-${tool.id}`}
                  className="text-sm font-semibold"
                >
                  Xác thực Admin Secret
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPendingPatch(null);
                  setModalError(null);
                }}
                aria-label="Đóng hộp thoại xác thực"
                className="rounded p-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mb-3 text-xs leading-relaxed text-zinc-400">
              Máy chủ yêu cầu <code className="font-mono text-zinc-300">x-admin-secret</code> để
              lưu thay đổi. Khóa chỉ được lưu tạm trong{" "}
              <code className="font-mono text-zinc-300">sessionStorage</code> của tab này.
            </p>

            <form onSubmit={handleAdminSecretSubmit} className="space-y-3">
              <input
                type="password"
                autoFocus
                value={adminSecretInput}
                onChange={(e) => setAdminSecretInput(e.target.value)}
                placeholder="Nhập ADMIN_SECRET..."
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500/60 focus:outline-none"
              />

              {modalError && (
                <p className="text-xs text-red-400">{modalError}</p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPendingPatch(null);
                    setModalError(null);
                  }}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Xác nhận &amp; Lưu</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
