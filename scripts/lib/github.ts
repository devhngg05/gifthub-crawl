import { z } from "zod";

export const GITHUB_API_BASE = "https://api.github.com";
export const GITHUB_API_VERSION = "2022-11-28";
export const MAX_README_LENGTH = 2500;
export const DEFAULT_PER_PAGE = 50;

export const BLOCKED_TOPICS = [
  "awesome",
  "awesome-list",
  "roadmap",
  "books",
  "interview-questions",
  "tutorial",
  "cheatsheet",
] as const;

const BLOCKED_TOPICS_SET = new Set<string>(BLOCKED_TOPICS);

export interface GitHubRepoItem {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  pushed_at: string;
  archived: boolean;
  topics: string[];
}

export interface CleanReadmeResult {
  sha: string | null;
  text: string;
}

export interface FetchCandidateReposOptions {
  now?: Date;
  perPage?: number;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface FetchCleanReadmeOptions {
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface GitHubSearchQueries {
  pillar: string;
  rising: string;
}

const GitHubRepoItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  full_name: z.string().min(1),
  html_url: z.string().url(),
  description: z.string().nullable().default(null),
  stargazers_count: z.number().int().nonnegative(),
  language: z.string().nullable().default(null),
  pushed_at: z.string().min(1),
  archived: z.boolean().default(false),
  topics: z.array(z.string()).default([]),
});

const GitHubSearchResponseSchema = z.object({
  items: z.array(GitHubRepoItemSchema),
});

const GitHubReadmeResponseSchema = z.object({
  sha: z.string().min(1),
  content: z.string(),
  encoding: z.string().optional(),
});

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

/** Tạo header chuẩn GitHub REST API; chỉ gắn Authorization khi có token. */
export function buildGitHubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": "github-tool-radar",
  };

  const resolvedToken = (token ?? process.env.GITHUB_TOKEN ?? "").trim();
  if (resolvedToken.length > 0) {
    headers.Authorization = `Bearer ${resolvedToken}`;
  }

  return headers;
}

/** Tạo 2 chuỗi truy vấn tìm kiếm GitHub: Trụ cột (>6 tháng gần đây) và Mới nổi (30 ngày). */
export function buildSearchQueries(
  now: Date = new Date(),
): GitHubSearchQueries {
  const sixMonthsAgo = formatUtcDate(subtractUtcMonths(now, 6));
  const thirtyDaysAgo = formatUtcDate(
    new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
  );

  return {
    pillar: `stars:>1500 pushed:>${sixMonthsAgo} archived:false`,
    rising: `stars:>500 created:>${thirtyDaysAgo} archived:false`,
  };
}

/** Quality Gate: loại bỏ repo archived, thiếu description hoặc chứa topic rác. */
export function passesQualityGate(repo: GitHubRepoItem): boolean {
  if (repo.archived === true) {
    return false;
  }

  if (!repo.description || repo.description.trim().length === 0) {
    return false;
  }

  for (const topic of repo.topics) {
    if (BLOCKED_TOPICS_SET.has(topic.trim().toLowerCase())) {
      return false;
    }
  }

  return true;
}

/** Gộp kết quả 2 luồng tìm kiếm, khử trùng theo `repo.id` và lọc qua Quality Gate. */
export function mergeAndFilterRepos(
  pillarRepos: readonly GitHubRepoItem[],
  risingRepos: readonly GitHubRepoItem[],
): GitHubRepoItem[] {
  const deduped = new Map<number, GitHubRepoItem>();

  for (const repo of pillarRepos) {
    deduped.set(repo.id, repo);
  }
  for (const repo of risingRepos) {
    if (!deduped.has(repo.id)) {
      deduped.set(repo.id, repo);
    }
  }

  return Array.from(deduped.values()).filter(passesQualityGate);
}

async function fetchSearchStream(
  streamName: string,
  query: string,
  perPage: number,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<GitHubRepoItem[]> {
  const url = `${GITHUB_API_BASE}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}`;
  const response = await fetchImpl(url, { headers });

  if (!response.ok) {
    throw new Error(
      `GitHub search (${streamName}) failed with HTTP ${response.status}`,
    );
  }

  const json: unknown = await response.json();
  const parsed = GitHubSearchResponseSchema.parse(json);
  return parsed.items;
}

/** Chạy song song 2 luồng tìm kiếm GitHub, khử trùng theo ID và áp dụng Quality Gate. */
export async function fetchCandidateRepos(
  options: FetchCandidateReposOptions = {},
): Promise<GitHubRepoItem[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const perPage = options.perPage ?? DEFAULT_PER_PAGE;
  const headers = buildGitHubHeaders(options.token);
  const queries = buildSearchQueries(options.now);

  const [pillarRepos, risingRepos] = await Promise.all([
    fetchSearchStream("pillar", queries.pillar, perPage, headers, fetchImpl),
    fetchSearchStream("rising", queries.rising, perPage, headers, fetchImpl),
  ]);

  return mergeAndFilterRepos(pillarRepos, risingRepos);
}

/**
 * Làm sạch nội dung README thô: xóa comment/HTML, linked badges, ảnh Markdown,
 * rút gọn khoảng trắng liên tiếp và cắt tối đa 2.500 ký tự đầu.
 */
export function cleanReadmeText(rawMarkdown: string): string {
  const cleaned = rawMarkdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(
      /\[!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])\](?:\([^)]*\)|\[[^\]]*\])/g,
      " ",
    )
    .replace(/!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])/g, " ")
    .replace(
      /^\s*\[[^\]]+\]:\s*https?:\/\/(?:img\.shields\.io|badgen\.net|badge\.fury\.io|codecov\.io|github\.com\/[^\s]*badge\.svg)[^\r\n]*$/gim,
      "",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.slice(0, MAX_README_LENGTH);
}

/** Tải README của repo, giải mã base64, làm sạch nội dung và xử lý an toàn HTTP 404. */
export async function fetchCleanReadme(
  fullName: string,
  options: FetchCleanReadmeOptions = {},
): Promise<CleanReadmeResult> {
  const parts = fullName.trim().split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid GitHub repository fullName: "${fullName}"`);
  }

  const [owner, repo] = parts;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = buildGitHubHeaders(options.token);
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`;

  const response = await fetchImpl(url, { headers });
  if (response.status === 404) {
    return { sha: null, text: "" };
  }

  if (!response.ok) {
    throw new Error(
      `GitHub README request failed for ${fullName} with HTTP ${response.status}`,
    );
  }

  const json: unknown = await response.json();
  const parsed = GitHubReadmeResponseSchema.parse(json);

  const rawText =
    parsed.encoding === "base64" || parsed.encoding === undefined
      ? Buffer.from(parsed.content.replace(/\s+/g, ""), "base64").toString(
          "utf-8",
        )
      : parsed.content;

  return {
    sha: parsed.sha,
    text: cleanReadmeText(rawText),
  };
}
