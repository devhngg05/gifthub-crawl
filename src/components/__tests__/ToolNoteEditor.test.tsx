// @vitest-environment jsdom
import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolNoteEditor } from "@/components/ToolNoteEditor";

interface StatefulNoteEditorProps {
  toolName?: string;
  initialNote?: string;
  onSaveRequest: (draft: string) => Promise<void>;
  onClearRequest?: () => Promise<void>;
}

function StatefulNoteEditor({
  toolName = "ollama",
  initialNote = "",
  onSaveRequest,
  onClearRequest,
}: StatefulNoteEditorProps) {
  const [savedNote, setSavedNote] = useState(initialNote);
  const [notesDraft, setNotesDraft] = useState(initialNote);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      await onSaveRequest(notesDraft);
      setSavedNote(notesDraft);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClear() {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      await onClearRequest?.();
      setSavedNote("");
      setNotesDraft("");
    } finally {
      setIsSaving(false);
    }
  }

  function handleCancel() {
    setNotesDraft(savedNote);
  }

  return (
    <ToolNoteEditor
      toolName={toolName}
      notesDraft={notesDraft}
      hasExistingNote={savedNote.length > 0}
      isSaving={isSaving}
      onNotesDraftChange={setNotesDraft}
      onSave={() => {
        void handleSave();
      }}
      onClear={() => {
        void handleClear();
      }}
      onCancel={handleCancel}
    />
  );
}

describe("ToolNoteEditor", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hiển thị đúng ghi chú ban đầu, bộ đếm ký tự và cho phép chỉnh sửa nội dung", async () => {
    const user = userEvent.setup();
    const initialNote = "Chạy model local mượt trên máy 16GB RAM";

    render(
      <StatefulNoteEditor
        toolName="ollama"
        initialNote={initialNote}
        onSaveRequest={vi.fn(async () => {})}
      />,
    );

    const textarea = screen.getByLabelText("Ghi chú cá nhân cho ollama");
    expect(textarea).toHaveValue(initialNote);
    expect(screen.getByText(`${initialNote.length}/2000`)).toBeInTheDocument();

    await user.clear(textarea);
    await user.type(textarea, "Ghi chú mới");

    expect(textarea).toHaveValue("Ghi chú mới");
    expect(screen.getByText("11/2000")).toBeInTheDocument();
  });

  it("bấm Lưu gọi handler với nội dung đã sửa và khóa toàn bộ control trong lúc đang lưu", async () => {
    const user = userEvent.setup();
    let resolveSave: (() => void) | undefined;
    const onSaveRequest = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );

    render(
      <StatefulNoteEditor
        toolName="n8n"
        initialNote="Bản cũ"
        onSaveRequest={onSaveRequest}
      />,
    );

    const textarea = screen.getByLabelText("Ghi chú cá nhân cho n8n");
    const saveButton = screen.getByRole("button", { name: "Lưu" });
    const cancelButton = screen.getByRole("button", { name: "Hủy" });
    const clearButton = screen.getByRole("button", { name: "Xóa" });

    await user.clear(textarea);
    await user.type(textarea, "Dùng tự động hóa webhook nội bộ");
    await user.click(saveButton);

    expect(onSaveRequest).toHaveBeenCalledTimes(1);
    expect(onSaveRequest).toHaveBeenCalledWith(
      "Dùng tự động hóa webhook nội bộ",
    );

    expect(textarea).toBeDisabled();
    expect(saveButton).toBeDisabled();
    expect(cancelButton).toBeDisabled();
    expect(clearButton).toBeDisabled();

    await act(async () => {
      resolveSave?.();
    });

    await waitFor(() => {
      expect(saveButton).toBeEnabled();
    });
    expect(textarea).toBeEnabled();
    expect(cancelButton).toBeEnabled();
    expect(clearButton).toBeEnabled();
    expect(textarea).toHaveValue("Dùng tự động hóa webhook nội bộ");
  });

  it("bấm Hủy khôi phục lại nội dung ban đầu và không gọi handler lưu", async () => {
    const user = userEvent.setup();
    const onSaveRequest = vi.fn(async () => {});
    const initialNote = "Ghi chú gốc ban đầu";

    render(
      <StatefulNoteEditor
        toolName="ripgrep"
        initialNote={initialNote}
        onSaveRequest={onSaveRequest}
      />,
    );

    const textarea = screen.getByLabelText("Ghi chú cá nhân cho ripgrep");
    await user.clear(textarea);
    await user.type(textarea, "Nội dung nháp chưa muốn lưu");
    expect(textarea).toHaveValue("Nội dung nháp chưa muốn lưu");

    await user.click(screen.getByRole("button", { name: "Hủy" }));

    expect(textarea).toHaveValue(initialNote);
    expect(screen.getByText(`${initialNote.length}/2000`)).toBeInTheDocument();
    expect(onSaveRequest).not.toHaveBeenCalled();
  });

  it("chỉ hiển thị nút Xóa khi có ghi chú cũ và gọi onClear khi bấm", async () => {
    const user = userEvent.setup();
    const onSaveRequest = vi.fn(async () => {});
    const onClearRequest = vi.fn(async () => {});

    const { unmount } = render(
      <StatefulNoteEditor
        toolName="jq"
        initialNote=""
        onSaveRequest={onSaveRequest}
      />,
    );
    expect(screen.queryByRole("button", { name: "Xóa" })).not.toBeInTheDocument();
    unmount();

    render(
      <StatefulNoteEditor
        toolName="jq"
        initialNote="Lọc JSON trên CLI"
        onSaveRequest={onSaveRequest}
        onClearRequest={onClearRequest}
      />,
    );

    const clearButton = screen.getByRole("button", { name: "Xóa" });
    await user.click(clearButton);

    expect(onClearRequest).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByLabelText("Ghi chú cá nhân cho jq")).toHaveValue("");
    });
    expect(screen.queryByRole("button", { name: "Xóa" })).not.toBeInTheDocument();
  });
});
