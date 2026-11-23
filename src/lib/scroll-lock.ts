export const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

let activeLockCount = 0;
let savedBodyOverflow: string | null = null;

/**
 * Chỉ cho phép khóa cuộn nền cho Mobile Drawer khi drawer đang mở và viewport không phải desktop.
 */
export function shouldLockMobileDrawerScroll(
  isOpen: boolean,
  isDesktop: boolean,
): boolean {
  return isOpen && !isDesktop;
}

/**
 * Khóa cuộn `document.body` có đếm tham chiếu (reference-counted) để nhiều overlay
 * chồng nhau (Mobile Drawer + Modal) không ghi đè hoặc làm kẹt `overflow: hidden`.
 */
export function acquireBodyScrollLock(): () => void {
  if (typeof document === "undefined" || !document.body) {
    return () => {};
  }

  if (activeLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }

  activeLockCount += 1;
  let released = false;

  return () => {
    if (released) {
      return;
    }
    released = true;

    activeLockCount = Math.max(0, activeLockCount - 1);

    if (activeLockCount === 0) {
      if (typeof document !== "undefined" && document.body) {
        document.body.style.overflow = savedBodyOverflow ?? "";
      }
      savedBodyOverflow = null;
    }
  };
}

/**
 * Trả về số khóa cuộn hiện đang hoạt động (dùng cho kiểm thử).
 */
export function getActiveBodyScrollLockCount(): number {
  return activeLockCount;
}

/**
 * Khôi phục trạng thái khóa cuộn về mặc định (dùng cho kiểm thử).
 */
export function resetBodyScrollLock(): void {
  if (
    typeof document !== "undefined" &&
    document.body &&
    savedBodyOverflow !== null
  ) {
    document.body.style.overflow = savedBodyOverflow;
  }
  activeLockCount = 0;
  savedBodyOverflow = null;
}
