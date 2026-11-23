/** Thời gian cửa sổ giới hạn tốc độ đăng nhập sai theo IP (15 phút). */
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Số lần nhập sai tối đa trước khi tạm khóa IP trong cửa sổ hiện tại. */
export const MAX_FAILED_ATTEMPTS = 5;

/** Giới hạn số IP lưu đồng thời trong bộ nhớ nhằm chống phình RAM khi brute-force phân tán. */
export const MAX_RATE_LIMIT_ENTRIES = 500;

export interface RateLimitCheckResult {
  blocked: boolean;
  retryAfterSeconds: number;
}

interface RateLimitRecord {
  failures: number;
  windowStartMs: number;
}

const failedAttemptsByIp = new Map<string, RateLimitRecord>();

/**
 * Dọn các mục hết hạn trước; nếu Map vẫn đạt/vượt ngưỡng `MAX_RATE_LIMIT_ENTRIES`,
 * tiếp tục xóa các khóa cũ nhất theo thứ tự chèn để giữ kích thước dưới trần.
 */
function pruneExpiredRateLimits(nowMs: number): void {
  if (failedAttemptsByIp.size < MAX_RATE_LIMIT_ENTRIES) {
    return;
  }

  for (const [ip, record] of failedAttemptsByIp.entries()) {
    if (nowMs - record.windowStartMs >= RATE_LIMIT_WINDOW_MS) {
      failedAttemptsByIp.delete(ip);
    }
  }

  while (failedAttemptsByIp.size >= MAX_RATE_LIMIT_ENTRIES) {
    const oldestKey = failedAttemptsByIp.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    failedAttemptsByIp.delete(oldestKey);
  }
}

/** Kiểm tra IP hiện tại có đang bị khóa tạm thời do đăng nhập sai quá số lần hay không. */
export function checkRateLimit(
  ip: string,
  nowMs = Date.now(),
): RateLimitCheckResult {
  const record = failedAttemptsByIp.get(ip);
  if (!record) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  const elapsed = nowMs - record.windowStartMs;
  if (elapsed >= RATE_LIMIT_WINDOW_MS) {
    failedAttemptsByIp.delete(ip);
    return { blocked: false, retryAfterSeconds: 0 };
  }

  if (record.failures >= MAX_FAILED_ATTEMPTS) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000),
    );
    return { blocked: true, retryAfterSeconds };
  }

  return { blocked: false, retryAfterSeconds: 0 };
}

/** Ghi nhận một lần đăng nhập sai theo IP và bảo đảm Map không bao giờ vượt trần bộ nhớ. */
export function recordFailedAttempt(ip: string, nowMs = Date.now()): void {
  const existing = failedAttemptsByIp.get(ip);
  if (existing) {
    if (nowMs - existing.windowStartMs < RATE_LIMIT_WINDOW_MS) {
      existing.failures += 1;
      return;
    }
    failedAttemptsByIp.delete(ip);
  }

  pruneExpiredRateLimits(nowMs);
  failedAttemptsByIp.set(ip, { failures: 1, windowStartMs: nowMs });
}

/** Xóa bộ đếm thất bại của một IP khi đăng nhập thành công. */
export function clearFailedAttempts(ip: string): void {
  failedAttemptsByIp.delete(ip);
}

/** Đặt lại bộ đếm giới hạn tốc độ đăng nhập phục vụ unit test. */
export function resetSessionRateLimitForTests(): void {
  failedAttemptsByIp.clear();
}

/** Trả về số lượng bản ghi IP đang lưu trong bộ nhớ phục vụ unit test. */
export function getRateLimitEntryCountForTests(): number {
  return failedAttemptsByIp.size;
}
