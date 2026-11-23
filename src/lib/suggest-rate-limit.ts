/** Thời gian cửa sổ giới hạn tốc độ truy vấn gợi ý theo IP (60 giây). */
export const SUGGEST_RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Số request tối đa cho phép trong một cửa sổ 60 giây trên mỗi IP. */
export const SUGGEST_MAX_REQUESTS = 60;

/** Giới hạn số IP lưu đồng thời trong bộ nhớ nhằm chống phình RAM khi bị flood phân tán. */
export const SUGGEST_MAX_ENTRIES = 1000;

export interface SuggestRateLimitResult {
  blocked: boolean;
  retryAfterSeconds: number;
}

interface SuggestRateLimitRecord {
  count: number;
  windowStartMs: number;
}

const requestCountsByIp = new Map<string, SuggestRateLimitRecord>();

/**
 * Dọn các mục hết hạn trước; nếu Map vẫn đạt/vượt ngưỡng `SUGGEST_MAX_ENTRIES`,
 * tiếp tục xóa các khóa cũ nhất theo thứ tự chèn để giữ kích thước dưới trần.
 */
function pruneExpiredEntries(nowMs: number): void {
  if (requestCountsByIp.size < SUGGEST_MAX_ENTRIES) {
    return;
  }

  for (const [ip, record] of requestCountsByIp.entries()) {
    if (nowMs - record.windowStartMs >= SUGGEST_RATE_LIMIT_WINDOW_MS) {
      requestCountsByIp.delete(ip);
    }
  }

  while (requestCountsByIp.size >= SUGGEST_MAX_ENTRIES) {
    const oldestKey = requestCountsByIp.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    requestCountsByIp.delete(oldestKey);
  }
}

/**
 * Kiểm tra và tiêu thụ 1 lượt gọi `/api/tools/suggest` cho IP hiện tại trong cửa sổ 60 giây.
 */
export function consumeSuggestRateLimit(
  ip: string,
  nowMs = Date.now(),
): SuggestRateLimitResult {
  const existing = requestCountsByIp.get(ip);
  if (existing) {
    const elapsed = nowMs - existing.windowStartMs;
    if (elapsed < SUGGEST_RATE_LIMIT_WINDOW_MS) {
      if (existing.count >= SUGGEST_MAX_REQUESTS) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((SUGGEST_RATE_LIMIT_WINDOW_MS - elapsed) / 1000),
        );
        return { blocked: true, retryAfterSeconds };
      }
      existing.count += 1;
      return { blocked: false, retryAfterSeconds: 0 };
    }
    requestCountsByIp.delete(ip);
  }

  pruneExpiredEntries(nowMs);
  requestCountsByIp.set(ip, { count: 1, windowStartMs: nowMs });
  return { blocked: false, retryAfterSeconds: 0 };
}

/** Đặt lại bộ đếm giới hạn tốc độ gợi ý phục vụ unit test. */
export function resetSuggestRateLimitForTests(): void {
  requestCountsByIp.clear();
}

/** Trả về số lượng bản ghi IP đang lưu trong bộ nhớ phục vụ unit test. */
export function getSuggestRateLimitEntryCountForTests(): number {
  return requestCountsByIp.size;
}
