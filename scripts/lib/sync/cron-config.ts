import {
  CORE_STREAM_NAMES,
  TOPIC_STREAM_NAMES,
  type GitHubSearchStreamName,
} from "../github/streams";
import type { RunSyncOptions } from "./runner";

export const CRON_MAX_SYNC_LIMIT = 5;
export const CRON_SYNC_BATCH_SIZE = 5;
export const CRON_SYNC_DELAY_MS = 0;
export const CRON_MAX_COOLDOWN_WAIT_MS = 5_000;
export const CRON_AI_TIMEOUT_MS = 20_000;
export const CRON_LOCK_TTL_SECONDS = 120;
export const CRON_GITHUB_PAGES_PER_QUERY = 1;
export const CRON_GITHUB_PER_PAGE = 50;
export const CRON_GITHUB_REQUEST_DELAY_MS = 300;
export const CRON_GITHUB_TIMEOUT_MS = 10_000;

const CRON_ROTATION_POOL: readonly GitHubSearchStreamName[] = [
  ...CORE_STREAM_NAMES.filter((name) => name !== "rising"),
  ...TOPIC_STREAM_NAMES,
];

/**
 * Chọn 2 luồng nhẹ (`rising` + 1 luồng xoay vòng theo giờ UTC) để Vercel Cron
 * hoàn tất bước tìm ứng viên trong ~1–2 giây, an toàn dưới trần `maxDuration = 60`.
 */
export function selectCronStreams(
  now: Date = new Date(),
): GitHubSearchStreamName[] {
  const utcHourSlot = Math.floor(
    Math.max(0, now.getTime()) / (60 * 60 * 1000),
  );
  const rotatedStream =
    CRON_ROTATION_POOL[utcHourSlot % CRON_ROTATION_POOL.length] ?? "pillarTop";
  return ["rising", rotatedStream];
}

/**
 * Đọc `CRON_SYNC_LIMIT` (hoặc `SYNC_LIMIT`) và ép trần an toàn `1..CRON_MAX_SYNC_LIMIT` (`5`)
 * để một lượt micro-batch trên Vercel Serverless luôn kịp hoàn tất trước timeout 60s.
 */
export function resolveCronSyncLimit(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.CRON_SYNC_LIMIT?.trim() || env.SYNC_LIMIT?.trim();
  if (!raw) {
    return CRON_MAX_SYNC_LIMIT;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return CRON_MAX_SYNC_LIMIT;
  }

  return Math.min(CRON_MAX_SYNC_LIMIT, parsed);
}

/** Tạo cấu hình `RunSyncOptions` micro-batch an toàn cho route `/api/cron/sync` trên Vercel. */
export function buildCronSyncOptions(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): RunSyncOptions {
  const syncLimit = resolveCronSyncLimit(env);

  const cronEnv: Record<string, string | undefined> = {
    ...env,
    SYNC_LIMIT: String(syncLimit),
    SYNC_BATCH_SIZE: String(CRON_SYNC_BATCH_SIZE),
    SYNC_DELAY_MS: String(CRON_SYNC_DELAY_MS),
    SYNC_RECLASSIFY: "none",
    SYNC_PRUNE_ONLY: "false",
    SYNC_LOCK_TTL_SECONDS: String(CRON_LOCK_TTL_SECONDS),
  };

  return {
    env: cronEnv,
    delayMs: CRON_SYNC_DELAY_MS,
    maxCooldownWaitMs: CRON_MAX_COOLDOWN_WAIT_MS,
    aiTimeoutMs: CRON_AI_TIMEOUT_MS,
    lockTtlSeconds: CRON_LOCK_TTL_SECONDS,
    lockOwner: "vercel-cron",
    useLock: true,
    enablePrune: true,
    fetchCandidateOptions: {
      now,
      streams: selectCronStreams(now),
      pagesPerQuery: CRON_GITHUB_PAGES_PER_QUERY,
      perPage: CRON_GITHUB_PER_PAGE,
      requestDelayMs: CRON_GITHUB_REQUEST_DELAY_MS,
      timeoutMs: CRON_GITHUB_TIMEOUT_MS,
    },
  };
}
