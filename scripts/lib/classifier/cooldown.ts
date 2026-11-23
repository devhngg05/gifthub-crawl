export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
export const MIN_RATE_LIMIT_COOLDOWN_MS = 1_000;
export const MAX_RATE_LIMIT_COOLDOWN_MS = 90_000;
export const TIMEOUT_COOLDOWN_MS = 180_000;
export const DAILY_QUOTA_COOLDOWN_MS = 1_800_000;
export const MAX_DAILY_QUOTA_COOLDOWN_MS = 86_400_000;
export const SERVER_ERROR_COOLDOWN_MS = 120_000;
export const SERVER_ERROR_ESCALATED_COOLDOWN_MS = 300_000;
export const DEFAULT_MAX_COOLDOWN_WAIT_MS = 65_000;
export const MAX_COOLDOWN_WAIT_ROUNDS = 2;
export const COOLDOWN_WAIT_BUFFER_MS = 1_000;

export type DailyQuotaSeverity = "none" | "soft" | "hard";

export class ProviderRateLimitError extends Error {
  readonly retryAfterMs: number;
  readonly isDailyQuota: boolean;
  readonly isHardDailyQuota: boolean;

  constructor(
    message: string,
    retryAfterMs: number,
    isDailyQuota = false,
    isHardDailyQuota = false,
  ) {
    super(message);
    this.name = "ProviderRateLimitError";
    this.retryAfterMs = retryAfterMs;
    this.isHardDailyQuota = isHardDailyQuota;
    this.isDailyQuota = isDailyQuota || isHardDailyQuota;
  }
}

export class ProviderServerError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ProviderServerError";
    this.status = status;
  }
}

export class AllProvidersExhaustedError extends Error {
  readonly allLongTermCooldown: boolean;
  readonly earliestRecoveryMs: number | null;

  constructor(
    message: string,
    allLongTermCooldown = false,
    earliestRecoveryMs: number | null = null,
  ) {
    super(message);
    this.name = "AllProvidersExhaustedError";
    this.allLongTermCooldown = allLongTermCooldown;
    this.earliestRecoveryMs = earliestRecoveryMs;
  }
}

const HARD_DAILY_QUOTA_PATTERN =
  /tokens?\s+per\s+day|requests?\s+per\s+day|\bTPD\b|\bRPD\b|\bPerDay\b|daily\s+(?:limit|quota)|\bper[-_\s]+day\b/i;

const CAMEL_PER_DAY_PATTERN = /(?:\b|[a-z0-9])PerDay(?:\b|[A-Z0-9])/;

const SOFT_DAILY_QUOTA_PATTERN =
  /exceeded your current quota|quota\s+exceeded/i;

/** Kiểm tra phản hồi HTTP 429 chắc chắn chạm hạn mức ngày (`TPD`, `RPD`, `PerDay`, `tokens per day`, ...). */
export function isHardDailyQuotaErrorBody(rawBody: string): boolean {
  return (
    HARD_DAILY_QUOTA_PATTERN.test(rawBody) ||
    CAMEL_PER_DAY_PATTERN.test(rawBody)
  );
}

/** Kiểm tra phản hồi HTTP 429 mang thông báo quota mơ hồ (có thể là RPM hoặc RPD). */
export function isSoftDailyQuotaErrorBody(rawBody: string): boolean {
  return (
    !isHardDailyQuotaErrorBody(rawBody) &&
    SOFT_DAILY_QUOTA_PATTERN.test(rawBody)
  );
}

/** Phân loại mức độ hết hạn mức ngày từ nội dung phản hồi HTTP 429. */
export function classifyDailyQuotaErrorBody(
  rawBody: string,
): DailyQuotaSeverity {
  if (isHardDailyQuotaErrorBody(rawBody)) {
    return "hard";
  }
  if (SOFT_DAILY_QUOTA_PATTERN.test(rawBody)) {
    return "soft";
  }
  return "none";
}

/** Kiểm tra phản hồi HTTP 429 có mang dấu hiệu chạm hạn mức ngày (cứng hoặc mềm) không. */
export function isDailyQuotaErrorBody(rawBody: string): boolean {
  return classifyDailyQuotaErrorBody(rawBody) !== "none";
}

/** Kiểm tra lỗi thuộc nhóm quá hạn thời gian chờ hoặc bị hủy (`TimeoutError` / `AbortError`). */
export function isTimeoutOrAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    /aborted due to timeout/i.test(error.message)
  );
}

const RATE_LIMIT_FAILURE_COUNTS = new WeakMap<
  Map<string, number>,
  Map<string, number>
>();

const SERVER_ERROR_FAILURE_COUNTS = new WeakMap<
  Map<string, number>,
  Map<string, number>
>();

function getScopedCountMap(
  registry: WeakMap<Map<string, number>, Map<string, number>>,
  cooldownMap: Map<string, number>,
): Map<string, number> {
  let counts = registry.get(cooldownMap);
  if (!counts) {
    counts = new Map<string, number>();
    registry.set(cooldownMap, counts);
  }
  return counts;
}

export function resetProviderFailureCounters(
  cooldownMap: Map<string, number>,
  providerName: string,
): void {
  getScopedCountMap(RATE_LIMIT_FAILURE_COUNTS, cooldownMap).delete(
    providerName,
  );
  getScopedCountMap(SERVER_ERROR_FAILURE_COUNTS, cooldownMap).delete(
    providerName,
  );
}

export function recordProviderFailureCooldown(
  providerName: string,
  error: unknown,
  nowMs: number,
  cooldownMap: Map<string, number>,
): void {
  if (error instanceof ProviderRateLimitError) {
    const failureCounts = getScopedCountMap(
      RATE_LIMIT_FAILURE_COUNTS,
      cooldownMap,
    );
    const nextCount = (failureCounts.get(providerName) ?? 0) + 1;
    failureCounts.set(providerName, nextCount);
    let cooldownMs = error.retryAfterMs;
    if (error.isHardDailyQuota) {
      cooldownMs = Math.max(DAILY_QUOTA_COOLDOWN_MS, error.retryAfterMs);
    } else if (error.isDailyQuota && nextCount >= 2) {
      cooldownMs = Math.max(DAILY_QUOTA_COOLDOWN_MS, error.retryAfterMs);
    }
    cooldownMap.set(providerName, nowMs + cooldownMs);
    return;
  }

  if (error instanceof ProviderServerError) {
    const serverCounts = getScopedCountMap(
      SERVER_ERROR_FAILURE_COUNTS,
      cooldownMap,
    );
    const nextCount = (serverCounts.get(providerName) ?? 0) + 1;
    serverCounts.set(providerName, nextCount);
    const cooldownMs =
      nextCount >= 2
        ? SERVER_ERROR_ESCALATED_COOLDOWN_MS
        : SERVER_ERROR_COOLDOWN_MS;
    cooldownMap.set(providerName, nowMs + cooldownMs);
    return;
  }

  if (isTimeoutOrAbortError(error)) {
    cooldownMap.set(providerName, nowMs + TIMEOUT_COOLDOWN_MS);
  }
}

function clampCooldownMs(
  rawMs: number,
  maxMs: number,
  defaultMs: number,
): number {
  if (!Number.isFinite(rawMs)) {
    return defaultMs;
  }
  return Math.min(
    maxMs,
    Math.max(MIN_RATE_LIMIT_COOLDOWN_MS, Math.ceil(rawMs)),
  );
}

/**
 * Trích xuất thời gian chờ hồi quota (ms) từ header `Retry-After` hoặc nội dung lỗi TPM/TPD khi gặp HTTP 429.
 * Với Hard Daily Quota, không kẹp trần 90s để giữ đúng thời gian chờ dài hạn.
 */
export function parseRateLimitRetryAfterMs(
  headers: Pick<Headers, "get">,
  rawBody: string,
  nowMs: number = Date.now(),
  options?: { isHardDailyQuota?: boolean },
): number {
  const isHardDaily =
    options?.isHardDailyQuota ?? isHardDailyQuotaErrorBody(rawBody);
  const maxCapMs = isHardDaily
    ? MAX_DAILY_QUOTA_COOLDOWN_MS
    : MAX_RATE_LIMIT_COOLDOWN_MS;
  const fallbackMs = isHardDaily
    ? DAILY_QUOTA_COOLDOWN_MS
    : DEFAULT_RATE_LIMIT_COOLDOWN_MS;

  const retryAfterHeader = headers.get("retry-after")?.trim();
  if (retryAfterHeader) {
    if (/^\d+(?:\.\d+)?$/.test(retryAfterHeader)) {
      return clampCooldownMs(
        Number(retryAfterHeader) * 1000,
        maxCapMs,
        fallbackMs,
      );
    }
    const parsedDate = Date.parse(retryAfterHeader);
    if (!Number.isNaN(parsedDate)) {
      return clampCooldownMs(parsedDate - nowMs, maxCapMs, fallbackMs);
    }
  }

  const bodyMatch = rawBody.match(
    /try again in\s+(?:(\d+)h(?=\s|\d|[.,;!?]|$)\s*)?(?:(\d+)m(?!s)(?=\s|\d|[.,;!?]|$)\s*)?(?:(\d+(?:\.\d+)?)(ms|s)(?=\s|[.,;!?]|$))?/i,
  );
  if (bodyMatch && (bodyMatch[1] || bodyMatch[2] || bodyMatch[3])) {
    const hours = bodyMatch[1] ? Number(bodyMatch[1]) : 0;
    const minutes = bodyMatch[2] ? Number(bodyMatch[2]) : 0;
    const value = bodyMatch[3] ? Number(bodyMatch[3]) : 0;
    const unit = bodyMatch[4]?.toLowerCase() ?? "s";
    const subMinuteMs = unit === "ms" ? value : value * 1000;
    const totalMs = hours * 3_600_000 + minutes * 60_000 + subMinuteMs;
    return clampCooldownMs(totalMs, maxCapMs, fallbackMs);
  }

  return fallbackMs;
}

/**
 * Kiểm tra toàn bộ provider đang kích hoạt có đều nằm trong cooldown vượt quá `maxWaitMs` hay không.
 */
export function areAllProvidersUnavailable(
  activeProviders: readonly { name: string }[],
  cooldownMap: ReadonlyMap<string, number> | undefined,
  nowMs: number,
  maxWaitMs: number = DEFAULT_MAX_COOLDOWN_WAIT_MS,
): boolean {
  if (!cooldownMap || activeProviders.length === 0) {
    return false;
  }

  return activeProviders.every((provider) => {
    const until = cooldownMap.get(provider.name);
    return until !== undefined && until - nowMs > maxWaitMs;
  });
}

/**
 * Trả về thời gian ngắn nhất (ms) để một provider bất kỳ hồi phục, hoặc `null` nếu có ít nhất 1 provider sẵn sàng.
 */
export function getEarliestProviderRecoveryMs(
  activeProviders: readonly { name: string }[],
  cooldownMap: ReadonlyMap<string, number> | undefined,
  nowMs: number,
): number | null {
  if (!cooldownMap || activeProviders.length === 0) {
    return null;
  }

  let minRemainingMs = Number.POSITIVE_INFINITY;
  for (const provider of activeProviders) {
    const until = cooldownMap.get(provider.name);
    if (until === undefined || until <= nowMs) {
      return null;
    }
    const remainingMs = until - nowMs;
    if (remainingMs < minRemainingMs) {
      minRemainingMs = remainingMs;
    }
  }

  return Number.isFinite(minRemainingMs) ? minRemainingMs : null;
}

/** Định dạng thời lượng hồi phục cooldown gọn gàng cho log cảnh báo. */
export function formatRecoveryDuration(ms: number): string {
  const totalSec = Math.max(1, Math.ceil(ms / 1000));
  if (totalSec < 60) {
    return `${totalSec}s`;
  }
  const totalMin = Math.ceil(totalSec / 60);
  if (totalMin < 60) {
    return `${totalMin}m`;
  }
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}
