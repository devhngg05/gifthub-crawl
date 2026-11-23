import { redactSecrets, sanitizeErrorMessage } from "@/lib/sanitize-error";
import {
  AllProvidersExhaustedError,
  areAllProvidersUnavailable,
  COOLDOWN_WAIT_BUFFER_MS,
  DEFAULT_MAX_COOLDOWN_WAIT_MS,
  formatRecoveryDuration,
  getEarliestProviderRecoveryMs,
  MAX_COOLDOWN_WAIT_ROUNDS,
  ProviderRateLimitError,
  recordProviderFailureCooldown,
  resetProviderFailureCounters,
} from "./cooldown";
import { type ActiveAiProvider } from "./providers";

export interface ClassifyRepoOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  providerCooldowns?: Map<string, number>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxCooldownWaitMs?: number;
}

/** Kiểm tra xem toàn bộ provider hoạt động đều đang cooldown vượt quá `maxCooldownWaitMs` hay không. */
export function areAllProvidersCoolingDownBeyondLimit(
  activeProviders: readonly ActiveAiProvider[],
  cooldownMap: ReadonlyMap<string, number> | undefined,
  nowMs: number,
  maxCooldownWaitMs: number,
): boolean {
  return areAllProvidersUnavailable(
    activeProviders,
    cooldownMap,
    nowMs,
    maxCooldownWaitMs,
  );
}

function buildExhaustedErrorMessage(
  label: string,
  failures: readonly string[],
  allLongTermCooldown: boolean,
  earliestRecoveryMs: number | null,
): string {
  if (allLongTermCooldown) {
    const compactFailures = failures.map((entry) =>
      entry.length > 90 ? `${entry.slice(0, 87)}...` : entry,
    );
    const recoveryHint =
      earliestRecoveryMs !== null
        ? ` [all cooling down; earliest recovery ~${formatRecoveryDuration(earliestRecoveryMs)}]`
        : " [all cooling down]";
    const prefix = `All AI providers failed for ${label}${recoveryHint}: `;
    const maxDetailLen = Math.max(0, 600 - prefix.length);
    const rawDetails = compactFailures.join("; ");
    const details =
      rawDetails.length > maxDetailLen && maxDetailLen > 3
        ? `${rawDetails.slice(0, maxDetailLen - 3)}...`
        : rawDetails.slice(0, maxDetailLen);
    return `${prefix}${details}`;
  }

  const fullMessage = `All AI providers failed for ${label}: ${failures.join("; ")}`;
  return fullMessage.length > 1800
    ? `${fullMessage.slice(0, 1797)}...`
    : fullMessage;
}

function sanitizeProviderFailureReason(
  error: unknown,
  provider: ActiveAiProvider,
): string {
  return redactSecrets(sanitizeErrorMessage(error), [provider.apiKey]);
}

export async function executeWithProviderFallback<T>(
  label: string,
  activeProviders: readonly ActiveAiProvider[],
  options: ClassifyRepoOptions,
  defaultTimeoutMs: number,
  attemptFn: (
    provider: ActiveAiProvider,
    timeoutMs: number,
    nowMs: number,
  ) => Promise<T>,
): Promise<{ data: T; provider: string }> {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const cooldownMap = options.providerCooldowns;
  const nowFn = options.now ?? (() => Date.now());
  const maxCooldownWaitMs =
    options.maxCooldownWaitMs ?? DEFAULT_MAX_COOLDOWN_WAIT_MS;
  const sleepImpl =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const failures: string[] = [];
  let justRateLimited = new Set<string>();

  for (const provider of activeProviders) {
    const currentNowMs = nowFn();
    const cooldownUntil = cooldownMap?.get(provider.name);

    if (cooldownUntil !== undefined) {
      if (cooldownUntil > currentNowMs) {
        const remainingSec = Math.ceil((cooldownUntil - currentNowMs) / 1000);
        failures.push(
          `${provider.name}: Cooling down (${remainingSec}s remaining)`,
        );
        continue;
      }
      cooldownMap?.delete(provider.name);
    }

    try {
      const data = await attemptFn(provider, timeoutMs, currentNowMs);
      cooldownMap?.delete(provider.name);
      if (cooldownMap) {
        resetProviderFailureCounters(cooldownMap, provider.name);
      }
      return { data, provider: provider.name };
    } catch (error) {
      const reason = sanitizeProviderFailureReason(error, provider);
      if (cooldownMap) {
        recordProviderFailureCooldown(
          provider.name,
          error,
          nowFn(),
          cooldownMap,
        );
      }
      if (error instanceof ProviderRateLimitError) {
        justRateLimited.add(provider.name);
      }
      failures.push(`${provider.name}: ${reason}`);
      console.warn(
        `[classifier] Provider ${provider.name} failed for ${label}: ${reason}`,
      );
    }
  }

  if (cooldownMap) {
    for (
      let waitRound = 1;
      waitRound <= MAX_COOLDOWN_WAIT_ROUNDS;
      waitRound += 1
    ) {
      const checkNowMs = nowFn();
      const coolingEntries: Array<{
        provider: ActiveAiProvider;
        until: number;
        remainingMs: number;
      }> = [];

      for (const provider of activeProviders) {
        const until = cooldownMap.get(provider.name);
        if (until !== undefined && until > checkNowMs) {
          coolingEntries.push({
            provider,
            until,
            remainingMs: until - checkNowMs,
          });
        }
      }

      if (coolingEntries.length === 0) {
        break;
      }

      // Ưu tiên chờ các provider đã cooldown từ trước thay vì quay lại ngay provider vừa dính 429 ở vòng hiện tại
      const preferredPool = coolingEntries.filter(
        (entry) =>
          !justRateLimited.has(entry.provider.name) &&
          entry.remainingMs <= maxCooldownWaitMs,
      );
      const fallbackPool = coolingEntries.filter(
        (entry) => entry.remainingMs <= maxCooldownWaitMs,
      );
      const targetPool =
        preferredPool.length > 0 ? preferredPool : fallbackPool;

      if (targetPool.length === 0) {
        break;
      }

      const minRemainingMs = Math.min(
        ...targetPool.map((entry) => entry.remainingMs),
      );
      const minCooldownUntil = checkNowMs + minRemainingMs;
      const waitMs = minRemainingMs + COOLDOWN_WAIT_BUFFER_MS;
      const waitSec = Math.max(1, Math.ceil(waitMs / 1000));

      console.warn(
        `[classifier] Tất cả provider đang cooldown, chờ ${waitSec}s (vòng ${waitRound}/${MAX_COOLDOWN_WAIT_ROUNDS})... (${label})`,
      );
      await sleepImpl(waitMs);

      const effectiveNowMs = Math.max(
        nowFn(),
        minCooldownUntil + COOLDOWN_WAIT_BUFFER_MS,
      );
      const recoveredProviders = targetPool
        .filter((entry) => entry.until <= effectiveNowMs)
        .map((entry) => entry.provider);

      const nextJustRateLimited = new Set<string>();

      for (const provider of recoveredProviders) {
        cooldownMap.delete(provider.name);
        try {
          const data = await attemptFn(provider, timeoutMs, effectiveNowMs);
          resetProviderFailureCounters(cooldownMap, provider.name);
          return { data, provider: provider.name };
        } catch (error) {
          const reason = sanitizeProviderFailureReason(error, provider);
          recordProviderFailureCooldown(
            provider.name,
            error,
            nowFn(),
            cooldownMap,
          );
          if (error instanceof ProviderRateLimitError) {
            nextJustRateLimited.add(provider.name);
          }
          failures.push(`${provider.name} (retry ${waitRound}): ${reason}`);
          console.warn(
            `[classifier] Provider ${provider.name} retry ${waitRound} failed for ${label}: ${reason}`,
          );
        }
      }

      justRateLimited = nextJustRateLimited;
    }
  }

  const finalNowMs = nowFn();
  const allLongTermCooldown = areAllProvidersUnavailable(
    activeProviders,
    cooldownMap,
    finalNowMs,
    maxCooldownWaitMs,
  );
  const earliestRecoveryMs = getEarliestProviderRecoveryMs(
    activeProviders,
    cooldownMap,
    finalNowMs,
  );
  throw new AllProvidersExhaustedError(
    buildExhaustedErrorMessage(
      label,
      failures,
      allLongTermCooldown,
      earliestRecoveryMs,
    ),
    allLongTermCooldown,
    earliestRecoveryMs,
  );
}
