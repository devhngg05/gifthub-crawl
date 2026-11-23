import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DESKTOP_MEDIA_QUERY,
  acquireBodyScrollLock,
  getActiveBodyScrollLockCount,
  resetBodyScrollLock,
  shouldLockMobileDrawerScroll,
} from "@/lib/scroll-lock";

interface MockBody {
  style: {
    overflow: string;
  };
}

describe("scroll-lock utility", () => {
  const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  let mockBody: MockBody;

  beforeEach(() => {
    mockBody = {
      style: {
        overflow: "",
      },
    };

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: {
        body: mockBody,
      },
    });

    resetBodyScrollLock();
  });

  afterEach(() => {
    resetBodyScrollLock();

    if (originalDocumentDescriptor) {
      Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  });

  it("khóa và khôi phục lại giá trị overflow trước đó của body", () => {
    mockBody.style.overflow = "auto";

    const release = acquireBodyScrollLock();
    expect(mockBody.style.overflow).toBe("hidden");
    expect(getActiveBodyScrollLockCount()).toBe(1);

    release();
    expect(mockBody.style.overflow).toBe("auto");
    expect(getActiveBodyScrollLockCount()).toBe(0);
  });

  it("gọi release nhiều lần trên cùng một khóa không làm sai lệch bộ đếm", () => {
    const release = acquireBodyScrollLock();
    expect(getActiveBodyScrollLockCount()).toBe(1);

    release();
    release();

    expect(mockBody.style.overflow).toBe("");
    expect(getActiveBodyScrollLockCount()).toBe(0);
  });

  it("chống kẹt overflow: hidden khi hai overlay đóng không theo thứ tự LIFO", () => {
    const releaseDrawer = acquireBodyScrollLock();
    expect(mockBody.style.overflow).toBe("hidden");
    expect(getActiveBodyScrollLockCount()).toBe(1);

    const releaseModal = acquireBodyScrollLock();
    expect(mockBody.style.overflow).toBe("hidden");
    expect(getActiveBodyScrollLockCount()).toBe(2);

    // Drawer đóng trước Modal (non-LIFO)
    releaseDrawer();
    expect(mockBody.style.overflow).toBe("hidden");
    expect(getActiveBodyScrollLockCount()).toBe(1);

    // Modal đóng sau cùng -> bắt buộc trả lại overflow rỗng ban đầu
    releaseModal();
    expect(mockBody.style.overflow).toBe("");
    expect(getActiveBodyScrollLockCount()).toBe(0);
  });

  it("không khóa cuộn body cho Mobile Drawer khi đang ở màn hình desktop", () => {
    expect(DESKTOP_MEDIA_QUERY).toBe("(min-width: 1024px)");
    expect(shouldLockMobileDrawerScroll(true, true)).toBe(false);
    expect(shouldLockMobileDrawerScroll(false, false)).toBe(false);
    expect(shouldLockMobileDrawerScroll(true, false)).toBe(true);
  });

  it("an toàn khi chạy ở môi trường SSR không có document", () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const release = acquireBodyScrollLock();
    expect(getActiveBodyScrollLockCount()).toBe(0);
    expect(() => release()).not.toThrow();
  });
});
