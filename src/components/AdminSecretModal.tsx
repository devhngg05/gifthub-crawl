"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2, X } from "lucide-react";
import { acquireBodyScrollLock } from "@/lib/scroll-lock";

export interface AdminSecretModalProps {
  open: boolean;
  titleId: string;
  isSaving: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onSubmit: (secret: string) => Promise<void>;
}

interface AdminSecretDialogProps {
  titleId: string;
  isSaving: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onSubmit: (secret: string) => Promise<void>;
}

function AdminSecretDialog({
  titleId,
  isSaving,
  errorMessage,
  onClose,
  onSubmit,
}: AdminSecretDialogProps) {
  const [secretInput, setSecretInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => acquireBodyScrollLock(), []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSaving, onClose]);

  const inputId = `${titleId}-input`;
  const displayedError = localError ?? errorMessage;

  async function handleFormSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isSaving) {
      return;
    }

    const trimmedSecret = secretInput.trim();
    if (!trimmedSecret) {
      setLocalError("Vui lòng nhập khóa quản trị.");
      return;
    }

    setLocalError(null);
    await onSubmit(trimmedSecret);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-xs"
        onClick={() => {
          if (!isSaving) {
            onClose();
          }
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-zinc-100">
            <KeyRound className="h-4 w-4 text-emerald-400" />
            <h2 id={titleId} className="text-sm font-semibold">
              Xác thực khóa quản trị
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Đóng hộp thoại xác thực"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-xs leading-relaxed text-zinc-400">
          Máy chủ yêu cầu phiên quản trị hợp lệ để lưu thay đổi. Khóa chỉ được
          gửi tới máy chủ một lần để cấp cookie phiên{" "}
          <code className="font-mono text-zinc-300">HttpOnly</code> đã ký và
          không lưu trên trình duyệt.
        </p>

        <form onSubmit={handleFormSubmit} className="space-y-3">
          <div>
            <label htmlFor={inputId} className="sr-only">
              Khóa quản trị
            </label>
            <input
              id={inputId}
              type="password"
              autoFocus
              disabled={isSaving}
              value={secretInput}
              onChange={(event) => {
                setSecretInput(event.target.value);
                if (localError) {
                  setLocalError(null);
                }
              }}
              placeholder="Nhập ADMIN_SECRET..."
              aria-label="Khóa quản trị"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 disabled:opacity-50"
            />
          </div>

          {displayedError && (
            <p role="alert" className="text-xs text-red-400">
              {displayedError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"
            >
              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Xác nhận &amp; Lưu</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Hộp thoại nhập khóa quản trị để khởi tạo phiên cookie `HttpOnly` khi API trả HTTP 401.
 * Unmount khi đóng để xóa sạch state input, hỗ trợ phím `Escape` và bấm nền ngoài.
 */
export function AdminSecretModal({
  open,
  titleId,
  isSaving,
  errorMessage,
  onClose,
  onSubmit,
}: AdminSecretModalProps) {
  if (!open) {
    return null;
  }

  return (
    <AdminSecretDialog
      titleId={titleId}
      isSaving={isSaving}
      errorMessage={errorMessage}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}
