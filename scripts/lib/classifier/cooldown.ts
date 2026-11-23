export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
export const MIN_RATE_LIMIT_COOLDOWN_MS = 1_000;
export const MAX_RATE_LIMIT_COOLDOWN_MS = 90_000;
export const TIMEOUT_COOLDOWN_MS = 180_000;
export const DAILY_QUOTA_COOLDOWN_MS = 1_800_000;
export const SERVER_ERROR_COOLDOWN_MS = 120_000;
export const SERVER_ERROR_ESCALATED_COOLDOWN_MS = 300_000;
export const DEFAULT_MAX_COOLDOWN_WAIT_MS = 65_000;
export const MAX_COOLDOWN_WAIT_ROUNDS = 2;
export const COOLDOWN_WAIT_BUFFER_MS = 1_000;

export class ProviderRateLimitError extends Error {
  readonly retryAfterMs: number;
  readonly isDailyQuota: boolean;

  constructor(message: string, retryAfterMs: number, isDailyQuota = false) {
    super(message);
    this.name = "ProviderRateLimitError";
    this.retryAfterMs = retryAfterMs;
    this.isDailyQuota = isDailyQuota;
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

const DAILY_QUOTA_PATTERN =
  /\bPerDay\b|exceeded your current quota|daily\s+(?:limit|quota)|quota\s+exceeded/i;

/** Kiểm tra phản hồi HTTP 429 có mang dấu hiệu chạm hạn mức ngày (`PerDay` / `exceeded your current quota`) không. */
export function isDailyQuotaErrorBody(rawBody: string): boolean {
  return DAILY_QUOTA_PATTERN.test(rawBody);
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
    const cooldownMs =
      error.isDailyQuota && nextCount >= 2
        ? DAILY_QUOTA_COOLDOWN_MS
        : error.retryAfterMs;
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

function clampCooldownMs(rawMs: number): number {
  if (!Number.isFinite(rawMs)) {
    return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  }
  return Math.min(
    MAX_RATE_LIMIT_COOLDOWN_MS,
    Math.max(MIN_RATE_LIMIT_COOLDOWN_MS, Math.ceil(rawMs)),
  );
}

/**
 * Trích xuất thời gian chờ hồi quota (ms) từ header `Retry-After` hoặc nội dung lỗi TPM (Groq) khi gặp HTTP 429.
 */
export function parseRateLimitRetryAfterMs(
  headers: Pick<Headers, "get">,
  rawBody: string,
  nowMs: number = Date.now(),
): number {
  const retryAfterHeader = headers.get("retry-after")?.trim();
  if (retryAfterHeader) {
    if (/^\d+(?:\.\d+)?$/.test(retryAfterHeader)) {
      return clampCooldownMs(Number(retryAfterHeader) * 1000);
    }
    const parsedDate = Date.parse(retryAfterHeader);
    if (!Number.isNaN(parsedDate)) {
      return clampCooldownMs(parsedDate - nowMs);
    }
  }

  const bodyMatch = rawBody.match(
    /try again in\s+(?:(\d+)m)?(\d+(?:\.\d+)?)(ms|s)\b/i,
  );
  if (bodyMatch) {
    const minutes = bodyMatch[1] ? Number(bodyMatch[1]) : 0;
    const value = Number(bodyMatch[2]);
    const unit = bodyMatch[3].toLowerCase();
    const totalMs =
      minutes * 60_000 + (unit === "ms" ? value : value * 1000);
    return clampCooldownMs(totalMs);
  }

  return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
}
