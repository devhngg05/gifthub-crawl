"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isValidSubCategory, type SubCategorySlug } from "@/config/taxonomy";
import {
  clearStoredAdminSecret,
  readStoredAdminSecret,
  saveStoredAdminSecret,
} from "@/lib/admin-secret-storage";
import { mapToolPatchErrorMessage } from "@/lib/ui-helpers";
import type { ToolPatchInput } from "@/lib/validator";

export interface UseToolMutationsInput {
  id: number;
  isPinned: boolean;
  subCategory: string;
  userNotes: string | null;
}

/**
 * Custom hook xử lý các thao tác cá nhân hóa `PATCH /api/tools/[id]`
 * (Ghim, Ghi chú, Đổi ngách), quản lý modal nhập `ADMIN_SECRET` khi 401 và làm mới dữ liệu trang.
 */
export function useToolMutations(tool: UseToolMutationsInput) {
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

  const [pendingPatch, setPendingPatch] = useState<ToolPatchInput | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  async function submitPatch(
    payload: ToolPatchInput,
    overrideSecret?: string,
  ): Promise<boolean> {
    if (isSaving) {
      return false;
    }

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
        setModalError(
          overrideSecret !== undefined
            ? "Khóa quản trị không đúng, vui lòng kiểm tra lại."
            : null,
        );
        return false;
      }

      if (!response.ok) {
        const mappedError = mapToolPatchErrorMessage(response.status);
        if (overrideSecret !== undefined) {
          setModalError(mappedError);
        } else {
          setErrorMessage(mappedError);
        }
        return false;
      }

      if (overrideSecret) {
        saveStoredAdminSecret(overrideSecret);
      }

      setPendingPatch(null);
      setModalError(null);
      router.refresh();
      return true;
    } catch {
      const networkError = "Không thể kết nối tới máy chủ, vui lòng thử lại.";
      if (overrideSecret !== undefined) {
        setModalError(networkError);
      } else {
        setErrorMessage(networkError);
      }
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
    const nextNotes = trimmed.length > 0 ? trimmed : null;
    const currentNotes = tool.userNotes?.trim() || null;

    if (nextNotes === currentNotes) {
      setIsNoteOpen(false);
      return;
    }

    const ok = await submitPatch({ userNotes: nextNotes });
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

  async function handleAdminSecretSubmit(secret: string) {
    if (!pendingPatch) {
      return;
    }
    const ok = await submitPatch(pendingPatch, secret);
    if (ok && "userNotes" in pendingPatch) {
      setIsNoteOpen(false);
    }
  }

  function closeAdminModal() {
    setPendingPatch(null);
    setModalError(null);
  }

  function cancelNotes() {
    setNotesDraft(tool.userNotes ?? "");
    setIsNoteOpen(false);
  }

  function toggleNoteOpen() {
    setIsNoteOpen((prev) => !prev);
  }

  return {
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
  };
}
