// @vitest-environment jsdom
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminSecretModal } from "@/components/AdminSecretModal";
import { resetBodyScrollLock } from "@/lib/scroll-lock";

interface ModalHarnessProps {
  initialOpen?: boolean;
  isSaving?: boolean;
  errorMessage?: string | null;
  onCloseSpy?: () => void;
  onSubmitSpy: (secret: string) => Promise<void>;
}

function ModalHarness({
  initialOpen = true,
  isSaving = false,
  errorMessage = null,
  onCloseSpy,
  onSubmitSpy,
}: ModalHarnessProps) {
  const [open, setOpen] = useState(initialOpen);

  return (
    <AdminSecretModal
      open={open}
      titleId="admin-modal-test"
      isSaving={isSaving}
      errorMessage={errorMessage}
      onClose={() => {
        onCloseSpy?.();
        setOpen(false);
      }}
      onSubmit={async (secret) => {
        await onSubmitSpy(secret);
        setOpen(false);
      }}
    />
  );
}

describe("AdminSecretModal", () => {
  afterEach(() => {
    resetBodyScrollLock();
    vi.clearAllMocks();
  });

  it("không render dialog và không khóa cuộn body khi open=false", () => {
    render(
      <AdminSecretModal
        open={false}
        titleId="admin-modal-closed"
        isSaving={false}
        errorMessage={null}
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => {})}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("nhập secret có khoảng trắng thừa và submit thành công sẽ trim, gọi callback và đóng modal", async () => {
    const user = userEvent.setup();
    const onSubmitSpy = vi.fn(async () => {});

    render(<ModalHarness onSubmitSpy={onSubmitSpy} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");

    const input = screen.getByLabelText("Khóa quản trị");
    await user.type(input, "  my-super-secret  ");
    await user.click(screen.getByRole("button", { name: "Xác nhận & Lưu" }));

    expect(onSubmitSpy).toHaveBeenCalledTimes(1);
    expect(onSubmitSpy).toHaveBeenCalledWith("my-super-secret");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(document.body.style.overflow).toBe("");
  });

  it("hiển thị thông báo lỗi khi submit rỗng hoặc toàn khoảng trắng và tự xóa lỗi khi gõ lại", async () => {
    const user = userEvent.setup();
    const onSubmitSpy = vi.fn(async () => {});

    render(<ModalHarness onSubmitSpy={onSubmitSpy} />);

    await user.click(screen.getByRole("button", { name: "Xác nhận & Lưu" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Vui lòng nhập khóa quản trị.",
    );
    expect(onSubmitSpy).not.toHaveBeenCalled();

    const input = screen.getByLabelText("Khóa quản trị");
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: "Xác nhận & Lưu" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Vui lòng nhập khóa quản trị.",
    );
    expect(onSubmitSpy).not.toHaveBeenCalled();

    await user.type(input, "a");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hiển thị thông báo lỗi từ bên ngoài qua prop errorMessage", () => {
    render(
      <AdminSecretModal
        open={true}
        titleId="admin-modal-error"
        isSaving={false}
        errorMessage="Khóa quản trị không đúng, vui lòng kiểm tra lại."
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Khóa quản trị không đúng, vui lòng kiểm tra lại.",
    );
  });

  it("đóng modal an toàn khi bấm Hủy, nút đóng X, bấm nền ngoài hoặc nhấn phím Escape", async () => {
    const user = userEvent.setup();
    const onCloseCancel = vi.fn();
    const { unmount } = render(
      <ModalHarness onCloseSpy={onCloseCancel} onSubmitSpy={vi.fn(async () => {})} />,
    );

    await user.click(screen.getByRole("button", { name: "Hủy" }));
    expect(onCloseCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    unmount();

    const onCloseIcon = vi.fn();
    const first = render(
      <ModalHarness onCloseSpy={onCloseIcon} onSubmitSpy={vi.fn(async () => {})} />,
    );
    await user.click(
      screen.getByRole("button", { name: "Đóng hộp thoại xác thực" }),
    );
    expect(onCloseIcon).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    first.unmount();

    const onCloseEsc = vi.fn();
    const second = render(
      <ModalHarness onCloseSpy={onCloseEsc} onSubmitSpy={vi.fn(async () => {})} />,
    );
    await user.keyboard("{Escape}");
    expect(onCloseEsc).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    second.unmount();

    const onCloseBackdrop = vi.fn();
    const { container } = render(
      <ModalHarness onCloseSpy={onCloseBackdrop} onSubmitSpy={vi.fn(async () => {})} />,
    );
    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as Element);
    expect(onCloseBackdrop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("vô hiệu hóa thao tác và không đóng bằng Escape/backdrop khi isSaving=true", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi.fn(async () => {});

    const { container } = render(
      <AdminSecretModal
        open={true}
        titleId="admin-modal-saving"
        isSaving={true}
        errorMessage={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByLabelText("Khóa quản trị")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hủy" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Xác nhận & Lưu" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Đóng hộp thoại xác thực" }),
    ).toBeDisabled();

    await user.keyboard("{Escape}");
    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as Element);

    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
