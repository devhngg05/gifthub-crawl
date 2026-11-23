"use client";

import { Save, Trash2 } from "lucide-react";

export interface ToolNoteEditorProps {
  toolName: string;
  notesDraft: string;
  hasExistingNote: boolean;
  isSaving: boolean;
  onNotesDraftChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  onCancel: () => void;
}

/**
 * Trình soạn thảo ghi chú cá nhân inline cho từng thẻ công cụ (giới hạn 2.000 ký tự).
 */
export function ToolNoteEditor({
  toolName,
  notesDraft,
  hasExistingNote,
  isSaving,
  onNotesDraftChange,
  onSave,
  onClear,
  onCancel,
}: ToolNoteEditorProps) {
  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <textarea
        value={notesDraft}
        disabled={isSaving}
        onChange={(event) => onNotesDraftChange(event.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="Nhập ghi chú cá nhân cho công cụ này..."
        aria-label={`Ghi chú cá nhân cho ${toolName}`}
        className="w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] tabular-nums text-zinc-400">
          {notesDraft.length}/2000
        </span>
        <div className="flex items-center gap-1.5">
          {hasExistingNote && (
            <button
              type="button"
              onClick={onClear}
              disabled={isSaving}
              className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300 hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              <span>Xóa</span>
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"
          >
            <Save className="h-3 w-3" />
            <span>Lưu</span>
          </button>
        </div>
      </div>
    </div>
  );
}
