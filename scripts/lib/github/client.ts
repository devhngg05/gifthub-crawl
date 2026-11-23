import { z } from "zod";
import { sanitizeErrorMessage } from "@/lib/sanitize-error";
import { cleanReadmeText } from "./readme-cleaner";
import {
  buildSearchQueries,
  DEFAULT_PAGES_PER_QUERY,
  MAX_PAGES_PER_QUERY,
  parseGitHubStreamMode,
  parseGitHubStreamsOverride,
  parsePagesPerQuery,
  selectSearchStreams,
  type GitHubSearchStreamName,
  type GitHubStreamMode,
} from "./streams";

export const GITHUB_API_BASE = "https://api.github.com";
export const GITHUB_API_VERSION = "2022-11-28";
export const DEFAULT_PER_PAGE = 100;
export const DEFAULT_SEARCH_REQUEST_DELAY_MS = 2500;
export const GITHUB_FETCH_TIMEOUT_MS = 20_000;

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
  homepage?: string | null;
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
  pagesPerQuery?: number;
  streamMode?: GitHubStreamMode;
  streams?: readonly GitHubSearchStreamName[];
  token?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  onProgress?: (message: string) => void;
  fetchImpl?: typeof fetch;
  requestDelayMs?: number;
  streamDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface FetchCleanReadmeOptions {
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const GitHubRepoItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  full_name: z.string().min(1),
  html_url: z
    .string()
    .url()
    .refine(
      (value) => {
        try {
          return new URL(value).protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "html_url must use https protocol" },
    ),
  homepage: z.string().nullable().optional().default(null),
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

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * Gộp kết quả từ nhiều luồng tìm kiếm theo cơ chế round-robin interleaving,
 * khử trùng theo `repo.id` và lọc nghiêm ngặt qua Quality Gate để trải đều mọi nhóm danh mục.
 */
export function mergeAndFilterRepos(
  ...streams: readonly (readonly GitHubRepoItem[])[]
): GitHubRepoItem[] {
  const seenIds = new Set<number>();
  const cursors = streams.map(() => 0);
  const merged: GitHubRepoItem[] = [];

  let progressed = true;
  while (progressed) {
    progressed = false;

    for (let s = 0; s < streams.length; s += 1) {
      const stream = streams[s];
      while (cursors[s] < stream.length) {
        const repo = stream[cursors[s]];
        cursors[s] += 1;

        if (!seenIds.has(repo.id) && passesQualityGate(repo)) {
          seenIds.add(repo.id);
          merged.push(repo);
          progressed = true;
          break;
        }
      }
    }
  }

  return merged;
}

async function fetchSearchStream(
  streamName: string,
  query: string,
  perPage: number,
  page: number,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<GitHubRepoItem[]> {
  const url = `${GITHUB_API_BASE}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}&page=${page}`;
  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(
      `GitHub search (${streamName}, page ${page}) failed with HTTP ${response.status}`,
    );
  }

  const json: unknown = await response.json();
  const parsed = GitHubSearchResponseSchema.parse(json);
  return parsed.items;
}

/**
 * Thu thập ứng viên từ các luồng tìm kiếm GitHub (mặc định `rotate`: 5 luồng lõi + 7 chủ đề xoay vòng;
 * hoặc `all`: 24 luồng) với phân trang `page=1..pagesPerQuery`, gửi tuần tự giãn cách `2500ms`,
 * khử trùng theo `repo.id`, xen kẽ đều và áp dụng Quality Gate.
 */
export async function fetchCandidateRepos(
  options: FetchCandidateReposOptions = {},
): Promise<GitHubRepoItem[]> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const perPage = options.perPage ?? DEFAULT_PER_PAGE;
  const pagesPerQuery =
    options.pagesPerQuery !== undefined
      ? Math.min(
          MAX_PAGES_PER_QUERY,
          Math.max(
            1,
            Math.floor(
              Number.isFinite(options.pagesPerQuery)
                ? options.pagesPerQuery
                : DEFAULT_PAGES_PER_QUERY,
            ),
          ),
        )
      : parsePagesPerQuery(env.GITHUB_PAGES_PER_QUERY);
  const streamMode =
    options.streamMode ?? parseGitHubStreamMode(env.GITHUB_STREAM_MODE);
  const explicitStreams =
    options.streams ?? parseGitHubStreamsOverride(env.GITHUB_STREAMS);
  const referenceNow = options.now ?? new Date();
  const timeoutMs = options.timeoutMs ?? GITHUB_FETCH_TIMEOUT_MS;
  const onProgress =
    options.onProgress ?? ((message: string) => console.log(message));
  const requestDelayMs =
    options.requestDelayMs ??
    options.streamDelayMs ??
    DEFAULT_SEARCH_REQUEST_DELAY_MS;
  const sleepImpl = options.sleep ?? defaultSleep;
  const headers = buildGitHubHeaders(options.token);
  const queries = buildSearchQueries(referenceNow);

  const streamDefinitions = selectSearchStreams(queries, {
    mode: streamMode,
    now: referenceNow,
    streams: explicitStreams,
  });

  const streamResults: GitHubRepoItem[][] = [];
  const totalStreams = streamDefinitions.length;
  let requestCount = 0;

  for (let sIdx = 0; sIdx < totalStreams; sIdx += 1) {
    const stream = streamDefinitions[sIdx];
    const streamNumber = sIdx + 1;
    const streamItems: GitHubRepoItem[] = [];

    for (let page = 1; page <= pagesPerQuery; page += 1) {
      if (requestCount > 0 && requestDelayMs > 0) {
        await sleepImpl(requestDelayMs);
      }
      requestCount += 1;

      onProgress(
        `[github] Stream ${streamNumber}/${totalStreams} (${stream.name}) — page ${page}/${pagesPerQuery}...`,
      );

      try {
        const items = await fetchSearchStream(
          stream.name,
          stream.query,
          perPage,
          page,
          headers,
          fetchImpl,
          timeoutMs,
        );
        streamItems.push(...items);

        if (items.length < perPage) {
          break;
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw error;
        }
        if (stream.isCore && page === 1) {
          throw error;
        }
        console.warn(
          `[github] Search (${stream.name}, page ${page}) skipped: ${sanitizeErrorMessage(error)}`,
        );
        break;
      }
    }

    streamResults.push(streamItems);
  }

  const merged = mergeAndFilterRepos(...streamResults);
  onProgress(
    `[github] Hoàn tất ${totalStreams} stream: ${merged.length} repo hợp lệ sau khi gộp/khử trùng.`,
  );
  return merged;
}

function parseRepoFullName(fullName: string): [string, string] {
  const parts = fullName.trim().split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid GitHub repository fullName: "${fullName}"`);
  }
  return [parts[0], parts[1]];
}

/** Tải metadata mới nhất của repository (`GET /repos/{owner}/{repo}`) phục vụ đồng bộ/phân loại lại. */
export async function fetchRepoMetadata(
  fullName: string,
  options: FetchCleanReadmeOptions = {},
): Promise<GitHubRepoItem | null> {
  const [owner, repo] = parseRepoFullName(fullName);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? GITHUB_FETCH_TIMEOUT_MS;
  const headers = buildGitHubHeaders(options.token);
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `GitHub repo metadata request failed for ${fullName} with HTTP ${response.status}`,
    );
  }

  const json: unknown = await response.json();
  return GitHubRepoItemSchema.parse(json);
}

/** Tải README của repo, giải mã base64, làm sạch nội dung và xử lý an toàn HTTP 404. */
export async function fetchCleanReadme(
  fullName: string,
  options: FetchCleanReadmeOptions = {},
): Promise<CleanReadmeResult> {
  const [owner, repo] = parseRepoFullName(fullName);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? GITHUB_FETCH_TIMEOUT_MS;
  const headers = buildGitHubHeaders(options.token);
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`;

  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
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
