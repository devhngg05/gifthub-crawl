import { z } from "zod";

export const DEFAULT_PAGES_PER_QUERY = 3;
export const MAX_PAGES_PER_QUERY = 10;
export const ROTATED_TOPIC_STREAM_COUNT = 7;

export type GitHubStreamMode = "rotate" | "all";
export const DEFAULT_GITHUB_STREAM_MODE: GitHubStreamMode = "rotate";

export interface GitHubSearchQueries {
  pillarTop: string;
  pillarMid: string;
  pillarBase: string;
  pillarLow: string;
  rising: string;
  cli: string;
  selfHosted: string;
  devtools: string;
  aiAgent: string;
  database: string;
  security: string;
  privacy: string;
  productivity: string;
  automation: string;
  monitoring: string;
  networking: string;
  media: string;
  desktopApp: string;
  mcp: string;
  localLlm: string;
  docker: string;
  analytics: string;
  noteTaking: string;
  openSourceAlternative: string;
}

export type GitHubSearchStreamName = keyof GitHubSearchQueries;

export interface SearchStreamDefinition {
  name: GitHubSearchStreamName;
  query: string;
  isCore: boolean;
}

export const CORE_STREAM_NAMES: readonly GitHubSearchStreamName[] = [
  "pillarTop",
  "pillarMid",
  "pillarBase",
  "pillarLow",
  "rising",
] as const;

export const TOPIC_STREAM_NAMES: readonly GitHubSearchStreamName[] = [
  "cli",
  "selfHosted",
  "devtools",
  "aiAgent",
  "database",
  "security",
  "privacy",
  "productivity",
  "automation",
  "monitoring",
  "networking",
  "media",
  "desktopApp",
  "mcp",
  "localLlm",
  "docker",
  "analytics",
  "noteTaking",
  "openSourceAlternative",
] as const;

const ALL_STREAM_NAMES: readonly GitHubSearchStreamName[] = [
  ...CORE_STREAM_NAMES,
  ...TOPIC_STREAM_NAMES,
];
const CORE_STREAM_SET = new Set<GitHubSearchStreamName>(CORE_STREAM_NAMES);
const VALID_STREAM_SET = new Set<string>(ALL_STREAM_NAMES);

const PagesPerQuerySchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_PAGES_PER_QUERY);

/** Đọc và kiểm tra `GITHUB_PAGES_PER_QUERY` từ env (mặc định 3, hợp lệ 1..10). */
export function parsePagesPerQuery(rawValue?: string): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    return DEFAULT_PAGES_PER_QUERY;
  }

  const normalized = rawValue.trim();
  const parsed = PagesPerQuerySchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(
      `Invalid GITHUB_PAGES_PER_QUERY value "${normalized}": expected an integer between 1 and ${MAX_PAGES_PER_QUERY}`,
    );
  }

  return parsed.data;
}

/** Đọc và kiểm tra `GITHUB_STREAM_MODE` (`rotate` mặc định hoặc `all`). */
export function parseGitHubStreamMode(rawValue?: string): GitHubStreamMode {
  if (rawValue === undefined || rawValue.trim() === "") {
    return DEFAULT_GITHUB_STREAM_MODE;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "rotate" || normalized === "all") {
    return normalized;
  }

  throw new Error(
    `Invalid GITHUB_STREAM_MODE value "${rawValue.trim()}": expected "rotate" or "all"`,
  );
}

/** Phân tích `GITHUB_STREAMS` (danh sách tên luồng ngăn cách bằng dấu phẩy). */
export function parseGitHubStreamsOverride(
  rawValue?: string,
): GitHubSearchStreamName[] | undefined {
  if (rawValue === undefined || rawValue.trim() === "") {
    return undefined;
  }

  const seen = new Set<GitHubSearchStreamName>();
  const selected: GitHubSearchStreamName[] = [];

  for (const part of rawValue.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    if (!VALID_STREAM_SET.has(trimmed)) {
      throw new Error(
        `Invalid GITHUB_STREAMS entry "${trimmed}": expected one of ${ALL_STREAM_NAMES.join(", ")}`,
      );
    }
    const streamName = trimmed as GitHubSearchStreamName;
    if (!seen.has(streamName)) {
      seen.add(streamName);
      selected.push(streamName);
    }
  }

  return selected.length > 0 ? selected : undefined;
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function subtractUtcMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const totalMonths = year * 12 + month - months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const maxDayInMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();

  return new Date(
    Date.UTC(targetYear, targetMonth, Math.min(day, maxDayInMonth)),
  );
}

/**
 * Tạo 24 luồng truy vấn GitHub Search API phủ rộng các dải sao, repo mới nổi và 19 chủ đề thực dụng:
 * - 5 luồng lõi (`>10000`, `3000..10000`, `1000..3000`, `500..1500` push trong 12 tháng; và `rising` tạo trong 60 ngày)
 * - 19 luồng chuyên đề thực dụng trải đều cả 10 nhóm danh mục.
 */
export function buildSearchQueries(
  now: Date = new Date(),
): GitHubSearchQueries {
  const twelveMonthsAgo = formatUtcDate(subtractUtcMonths(now, 12));
  const sixtyDaysAgo = formatUtcDate(
    new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
  );

  return {
    pillarTop: `stars:>10000 pushed:>${twelveMonthsAgo} archived:false`,
    pillarMid: `stars:3000..10000 pushed:>${twelveMonthsAgo} archived:false`,
    pillarBase: `stars:1000..3000 pushed:>${twelveMonthsAgo} archived:false`,
    pillarLow: `stars:500..1500 pushed:>${twelveMonthsAgo} archived:false`,
    rising: `stars:>300 created:>${sixtyDaysAgo} archived:false`,
    cli: `topic:cli stars:>500 archived:false`,
    selfHosted: `topic:self-hosted stars:>500 archived:false`,
    devtools: `topic:developer-tools stars:>500 archived:false`,
    aiAgent: `topic:ai-agent stars:>500 archived:false`,
    database: `topic:database stars:>500 archived:false`,
    security: `topic:security stars:>500 archived:false`,
    privacy: `topic:privacy stars:>500 archived:false`,
    productivity: `topic:productivity stars:>500 archived:false`,
    automation: `topic:automation stars:>500 archived:false`,
    monitoring: `topic:monitoring stars:>500 archived:false`,
    networking: `topic:networking stars:>500 archived:false`,
    media: `topic:media stars:>500 archived:false`,
    desktopApp: `topic:desktop-app stars:>500 archived:false`,
    mcp: `topic:mcp stars:>300 archived:false`,
    localLlm: `topic:local-llm stars:>300 archived:false`,
    docker: `topic:docker stars:>500 archived:false`,
    analytics: `topic:analytics stars:>500 archived:false`,
    noteTaking: `topic:note-taking stars:>300 archived:false`,
    openSourceAlternative: `topic:open-source-alternative stars:>300 archived:false`,
  };
}

/**
 * Chọn tập luồng chạy cho lượt thu thập hiện tại:
 * - Nếu có danh sách `streams` chỉ định sẵn: dùng đúng danh sách đó.
 * - `mode = "all"`: chạy toàn bộ 24 luồng.
 * - `mode = "rotate"` (mặc định): chạy 5 luồng lõi + 7 luồng chủ đề xoay vòng theo khung 6h UTC.
 */
export function selectSearchStreams(
  queries: GitHubSearchQueries,
  options: {
    mode?: GitHubStreamMode;
    now?: Date;
    streams?: readonly GitHubSearchStreamName[];
  } = {},
): SearchStreamDefinition[] {
  if (options.streams && options.streams.length > 0) {
    return options.streams.map((name) => ({
      name,
      query: queries[name],
      isCore: CORE_STREAM_SET.has(name),
    }));
  }

  const mode = options.mode ?? DEFAULT_GITHUB_STREAM_MODE;
  if (mode === "all") {
    return ALL_STREAM_NAMES.map((name) => ({
      name,
      query: queries[name],
      isCore: CORE_STREAM_SET.has(name),
    }));
  }

  const referenceTime = options.now ?? new Date();
  const sixHourSlot = Math.floor(
    Math.max(0, referenceTime.getTime()) / (6 * 60 * 60 * 1000),
  );
  const startIdx =
    (sixHourSlot * ROTATED_TOPIC_STREAM_COUNT) % TOPIC_STREAM_NAMES.length;

  const rotatedTopics: GitHubSearchStreamName[] = [];
  for (let i = 0; i < ROTATED_TOPIC_STREAM_COUNT; i += 1) {
    const idx = (startIdx + i) % TOPIC_STREAM_NAMES.length;
    rotatedTopics.push(TOPIC_STREAM_NAMES[idx]);
  }

  return [...CORE_STREAM_NAMES, ...rotatedTopics].map((name) => ({
    name,
    query: queries[name],
    isCore: CORE_STREAM_SET.has(name),
  }));
}
