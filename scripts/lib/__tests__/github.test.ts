import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BLOCKED_TOPICS,
  buildGitHubHeaders,
  buildSearchQueries,
  cleanReadmeText,
  CORE_STREAM_NAMES,
  DEFAULT_GITHUB_STREAM_MODE,
  DEFAULT_PAGES_PER_QUERY,
  DEFAULT_PER_PAGE,
  DEFAULT_SEARCH_REQUEST_DELAY_MS,
  fetchCandidateRepos,
  fetchCleanReadme,
  fetchRepoMetadata,
  GITHUB_FETCH_TIMEOUT_MS,
  MAX_README_LENGTH,
  mergeAndFilterRepos,
  parseGitHubStreamMode,
  parseGitHubStreamsOverride,
  parsePagesPerQuery,
  passesQualityGate,
  ROTATED_TOPIC_STREAM_COUNT,
  selectSearchStreams,
  TOPIC_STREAM_NAMES,
  type GitHubRepoItem,
} from "../github";

function makeRepo(overrides: Partial<GitHubRepoItem> = {}): GitHubRepoItem {
  return {
    id: 1,
    name: "cool-tool",
    full_name: "acme/cool-tool",
    html_url: "https://github.com/acme/cool-tool",
    homepage: null,
    description: "A fast open-source developer utility",
    stargazers_count: 2400,
    language: "TypeScript",
    pushed_at: "2026-11-01T10:00:00Z",
    archived: false,
    topics: ["cli", "automation"],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("github collector — headers, stream modes & search queries", () => {
  it("uses per_page=100, pagesPerQuery=3, rotate stream mode, requestDelayMs=2500, timeout=20s by default", () => {
    expect(DEFAULT_PER_PAGE).toBe(100);
    expect(DEFAULT_PAGES_PER_QUERY).toBe(3);
    expect(DEFAULT_GITHUB_STREAM_MODE).toBe("rotate");
    expect(ROTATED_TOPIC_STREAM_COUNT).toBe(7);
    expect(DEFAULT_SEARCH_REQUEST_DELAY_MS).toBe(2500);
    expect(GITHUB_FETCH_TIMEOUT_MS).toBe(20_000);

    expect(parsePagesPerQuery(undefined)).toBe(3);
    expect(parsePagesPerQuery("")).toBe(3);
    expect(parsePagesPerQuery("1")).toBe(1);
    expect(parsePagesPerQuery(" 10 ")).toBe(10);
    expect(() => parsePagesPerQuery("0")).toThrow(/Invalid GITHUB_PAGES_PER_QUERY/);
    expect(() => parsePagesPerQuery("11")).toThrow(/Invalid GITHUB_PAGES_PER_QUERY/);
    expect(() => parsePagesPerQuery("abc")).toThrow(/Invalid GITHUB_PAGES_PER_QUERY/);

    expect(parseGitHubStreamMode(undefined)).toBe("rotate");
    expect(parseGitHubStreamMode("")).toBe("rotate");
    expect(parseGitHubStreamMode("ALL")).toBe("all");
    expect(parseGitHubStreamMode("  rotate ")).toBe("rotate");
    expect(() => parseGitHubStreamMode("random")).toThrow(
      /Invalid GITHUB_STREAM_MODE/,
    );

    expect(parseGitHubStreamsOverride(undefined)).toBeUndefined();
    expect(parseGitHubStreamsOverride("   ")).toBeUndefined();
    expect(parseGitHubStreamsOverride("pillarTop, mcp, localLlm, mcp")).toEqual([
      "pillarTop",
      "mcp",
      "localLlm",
    ]);
    expect(() => parseGitHubStreamsOverride("pillarTop,invalidStream")).toThrow(
      /Invalid GITHUB_STREAMS/,
    );

    const withToken = buildGitHubHeaders("ghp_mock_token_123");
    expect(withToken).toMatchObject({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: "Bearer ghp_mock_token_123",
    });

    const withoutToken = buildGitHubHeaders("");
    expect(withoutToken).toMatchObject({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    expect(withoutToken.Authorization).toBeUndefined();
  });

  it("builds 24 diverse search queries across 5 core streams and 19 practical topic streams", () => {
    const now = new Date("2026-11-22T12:00:00Z");
    const queries = buildSearchQueries(now);

    expect(Object.keys(queries)).toHaveLength(24);
    expect(CORE_STREAM_NAMES).toHaveLength(5);
    expect(TOPIC_STREAM_NAMES).toHaveLength(19);

    expect(queries).toEqual({
      pillarTop: "stars:>10000 pushed:>2025-11-22 archived:false",
      pillarMid: "stars:3000..10000 pushed:>2025-11-22 archived:false",
      pillarBase: "stars:1000..3000 pushed:>2025-11-22 archived:false",
      pillarLow: "stars:500..1500 pushed:>2025-11-22 archived:false",
      rising: "stars:>300 created:>2026-09-23 archived:false",
      cli: "topic:cli stars:>500 archived:false",
      selfHosted: "topic:self-hosted stars:>500 archived:false",
      devtools: "topic:developer-tools stars:>500 archived:false",
      aiAgent: "topic:ai-agent stars:>500 archived:false",
      database: "topic:database stars:>500 archived:false",
      security: "topic:security stars:>500 archived:false",
      privacy: "topic:privacy stars:>500 archived:false",
      productivity: "topic:productivity stars:>500 archived:false",
      automation: "topic:automation stars:>500 archived:false",
      monitoring: "topic:monitoring stars:>500 archived:false",
      networking: "topic:networking stars:>500 archived:false",
      media: "topic:media stars:>500 archived:false",
      desktopApp: "topic:desktop-app stars:>500 archived:false",
      mcp: "topic:mcp stars:>300 archived:false",
      localLlm: "topic:local-llm stars:>300 archived:false",
      docker: "topic:docker stars:>500 archived:false",
      analytics: "topic:analytics stars:>500 archived:false",
      noteTaking: "topic:note-taking stars:>300 archived:false",
      openSourceAlternative:
        "topic:open-source-alternative stars:>300 archived:false",
    });
  });

  it("rotates 7 topic streams alongside 5 core streams per 6h UTC slot in rotate mode and covers all 19 topics", () => {
    const queries = buildSearchQueries(new Date("2026-11-22T00:00:00Z"));
    const allStreams = selectSearchStreams(queries, { mode: "all" });
    expect(allStreams).toHaveLength(24);

    const seenTopics = new Set<string>();
    const slot0 = selectSearchStreams(queries, {
      mode: "rotate",
      now: new Date("2026-11-22T00:00:00Z"),
    });
    const slot1 = selectSearchStreams(queries, {
      mode: "rotate",
      now: new Date("2026-11-22T06:00:00Z"),
    });
    const slot2 = selectSearchStreams(queries, {
      mode: "rotate",
      now: new Date("2026-11-22T12:00:00Z"),
    });

    for (const run of [slot0, slot1, slot2]) {
      expect(run).toHaveLength(12);
      expect(run.slice(0, 5).map((s) => s.name)).toEqual([...CORE_STREAM_NAMES]);
      for (const item of run.slice(5)) {
        seenTopics.add(item.name);
      }
    }

    expect(seenTopics.size).toBe(TOPIC_STREAM_NAMES.length);
  });

  it("clamps month overflow safely when subtracting 12 months on leap day", () => {
    const now = new Date("2028-02-29T00:00:00Z");
    const queries = buildSearchQueries(now);

    expect(queries.pillarTop).toBe(
      "stars:>10000 pushed:>2027-02-28 archived:false",
    );
    expect(queries.pillarMid).toBe(
      "stars:3000..10000 pushed:>2027-02-28 archived:false",
    );
    expect(queries.pillarBase).toBe(
      "stars:1000..3000 pushed:>2027-02-28 archived:false",
    );
    expect(queries.pillarLow).toBe(
      "stars:500..1500 pushed:>2027-02-28 archived:false",
    );
  });
});

describe("github collector — deduplication, interleaving & quality gate", () => {
  it("rejects archived repos, missing descriptions, and all blocked topics", () => {
    expect(passesQualityGate(makeRepo({ archived: true }))).toBe(false);
    expect(passesQualityGate(makeRepo({ description: null }))).toBe(false);
    expect(passesQualityGate(makeRepo({ description: "   " }))).toBe(false);

    for (const blocked of BLOCKED_TOPICS) {
      expect(
        passesQualityGate(makeRepo({ topics: ["developer-tools", blocked] })),
      ).toBe(false);
      expect(
        passesQualityGate(makeRepo({ topics: [blocked.toUpperCase()] })),
      ).toBe(false);
    }

    expect(
      passesQualityGate(makeRepo({ topics: ["developer-tools", "api-client"] })),
    ).toBe(true);
  });

  it("interleaves streams round-robin, deduplicates by repo.id, and enforces quality gate", () => {
    const streamA = [
      makeRepo({ id: 1, full_name: "acme/a1" }),
      makeRepo({ id: 2, full_name: "acme/a2-blocked", topics: ["awesome"] }),
      makeRepo({ id: 3, full_name: "acme/a3" }),
    ];
    const streamB = [
      makeRepo({ id: 1, full_name: "acme/a1-dup" }),
      makeRepo({ id: 4, full_name: "acme/b1" }),
      makeRepo({ id: 5, full_name: "acme/b2" }),
    ];
    const streamC = [makeRepo({ id: 6, full_name: "acme/c1" })];

    const merged = mergeAndFilterRepos(streamA, streamB, streamC);
    expect(merged.map((r) => r.id)).toEqual([1, 4, 6, 3, 5]);
  });

  it("fetches default 12 rotated streams with per_page=100, preserves homepage, deduplicates by repo.id, and enforces quality gate", async () => {
    const sharedRepo = makeRepo({
      id: 101,
      name: "shared-cli",
      full_name: "acme/shared-cli",
      homepage: "https://shared-cli.dev",
    });
    const pillarTopOnly = makeRepo({
      id: 102,
      name: "pillar-top-tool",
      full_name: "acme/pillar-top-tool",
    });
    const pillarMidOnly = makeRepo({
      id: 114,
      name: "pillar-mid-tool",
      full_name: "acme/pillar-mid-tool",
    });
    const pillarBaseOnly = makeRepo({
      id: 115,
      name: "pillar-base-tool",
      full_name: "acme/pillar-base-tool",
    });
    const pillarLowOnly = makeRepo({
      id: 116,
      name: "pillar-low-tool",
      full_name: "acme/pillar-low-tool",
    });
    const risingOnly = makeRepo({
      id: 103,
      name: "rising-tool",
      full_name: "acme/rising-tool",
    });
    const topicRepo = makeRepo({
      id: 120,
      name: "topic-tool",
      full_name: "acme/topic-tool",
    });
    const blockedAwesome = makeRepo({
      id: 104,
      name: "awesome-ai",
      full_name: "acme/awesome-ai",
      topics: ["awesome-list"],
    });
    const noDescription = makeRepo({
      id: 105,
      name: "no-desc",
      full_name: "acme/no-desc",
      description: null,
    });
    const archivedRepo = makeRepo({
      id: 106,
      name: "old-repo",
      full_name: "acme/old-repo",
      archived: true,
    });

    const sleepMock = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      expect(url).toContain("per_page=100");
      expect(url).toContain("&page=1");

      if (url.includes("stars%3A%3E10000")) {
        return Response.json({
          items: [sharedRepo, blockedAwesome, noDescription, pillarTopOnly],
        });
      }
      if (url.includes("stars%3A3000..10000")) {
        return Response.json({ items: [pillarMidOnly] });
      }
      if (url.includes("stars%3A1000..3000")) {
        return Response.json({ items: [pillarBaseOnly] });
      }
      if (url.includes("stars%3A500..1500")) {
        return Response.json({ items: [pillarLowOnly] });
      }
      if (url.includes("created%3A%3E")) {
        return Response.json({ items: [sharedRepo, risingOnly, archivedRepo] });
      }
      if (url.includes("topic%3A")) {
        return Response.json({
          items: url.includes("topic%3Acli") ? [sharedRepo, topicRepo] : [],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const progressLogs: string[] = [];
    const result = await fetchCandidateRepos({
      now: new Date("2026-11-22T00:00:00Z"),
      token: "ghp_secret_for_test",
      env: { GITHUB_PAGES_PER_QUERY: "1" },
      onProgress: (message) => progressLogs.push(message),
      fetchImpl: fetchMock,
      sleep: sleepMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(sleepMock).toHaveBeenCalledTimes(11);
    for (const [ms] of sleepMock.mock.calls) {
      expect(ms).toBe(DEFAULT_SEARCH_REQUEST_DELAY_MS);
    }

    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: "Bearer ghp_secret_for_test",
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }

    expect(progressLogs[0]).toBe("[github] Stream 1/12 (pillarTop) — page 1/1...");
    expect(progressLogs.at(-1)).toBe(
      "[github] Hoàn tất 12 stream: 7 repo hợp lệ sau khi gộp/khử trùng.",
    );
    expect(result[0]?.homepage).toBe("https://shared-cli.dev");
    expect(result.map((r) => r.id)).toEqual([101, 114, 115, 116, 103, 120, 102]);
  });

  it("supports GITHUB_STREAM_MODE=all (24 streams) and paginates up to pagesPerQuery=3 cleanly", async () => {
    const sleepMock = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const makeStreamPage = (prefixId: number, count: number) =>
      Array.from({ length: count }, (_, idx) =>
        makeRepo({
          id: prefixId + idx,
          name: `repo-${prefixId + idx}`,
          full_name: `acme/repo-${prefixId + idx}`,
        }),
      );

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const q = url.searchParams.get("q") ?? "";
      const page = Number(url.searchParams.get("page") ?? "1");

      if (q.startsWith("stars:>10000")) {
        if (page === 1) {
          return Response.json({ items: makeStreamPage(1000, 2) });
        }
        if (page === 2) {
          return Response.json({
            items: [makeRepo({ id: 1000 }), makeRepo({ id: 1002 })],
          });
        }
        if (page === 3) {
          return Response.json({ items: [makeRepo({ id: 1003 })] });
        }
      }

      if (q.startsWith("topic:mcp")) {
        return Response.json({ items: [makeRepo({ id: 2000 })] });
      }

      return Response.json({ items: [] });
    });

    const result = await fetchCandidateRepos({
      now: new Date("2026-11-22T00:00:00Z"),
      perPage: 2,
      pagesPerQuery: 3,
      env: { GITHUB_STREAM_MODE: "all" },
      requestDelayMs: 2500,
      fetchImpl: fetchMock,
      sleep: sleepMock,
    });

    // pillarTop called 3 times (p1=2, p2=2, p3=1); other 23 streams called 1 time each -> 26 calls
    expect(fetchMock).toHaveBeenCalledTimes(26);
    expect(sleepMock).toHaveBeenCalledTimes(25);
    expect(result.map((r) => r.id)).toEqual([1000, 2000, 1001, 1002, 1003]);
  });

  it("continues gracefully when a supplementary topic stream or page >= 2 hits HTTP 403 rate limit", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pillarTopP1 = Array.from({ length: 100 }, (_, idx) =>
      makeRepo({
        id: 3000 + idx,
        name: `top-${idx}`,
        full_name: `acme/top-${idx}`,
      }),
    );
    const risingRepo = makeRepo({ id: 302, full_name: "acme/rising" });

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const parsedUrl = new URL(String(input));
      const q = parsedUrl.searchParams.get("q") ?? "";
      const page = Number(parsedUrl.searchParams.get("page") ?? "1");

      if (q.startsWith("stars:>10000")) {
        if (page === 1) {
          return Response.json({ items: pillarTopP1 });
        }
        return new Response("Secondary rate limit on page 2", { status: 403 });
      }
      if (q.startsWith("topic:security")) {
        return new Response("Secondary rate limit", { status: 403 });
      }
      if (q.includes("created:>")) {
        return Response.json({ items: [risingRepo] });
      }
      return Response.json({ items: [] });
    });

    const result = await fetchCandidateRepos({
      now: new Date("2026-11-22T00:00:00Z"),
      streams: ["pillarTop", "rising", "security"],
      token: "ghp_secret_for_test",
      fetchImpl: fetchMock,
      requestDelayMs: 0,
    });

    expect(result).toHaveLength(101);
    expect(result[0]?.id).toBe(3000);
    expect(result[1]?.id).toBe(302);
    expect(warnSpy.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining("pillarTop, page 2"),
      expect.stringContaining("security, page 1"),
    ]);
  });

  it("rejects candidate repositories whose html_url does not use https protocol", async () => {
    const unsafeRepo = {
      ...makeRepo({ id: 201 }),
      html_url: "javascript:alert(1)",
    };

    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ items: [unsafeRepo] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(
      fetchCandidateRepos({
        now: new Date("2026-11-22T00:00:00Z"),
        token: "ghp_secret_for_test",
        fetchImpl: fetchMock,
        streamDelayMs: 0,
      }),
    ).rejects.toThrow("html_url must use https protocol");
  });
});

describe("github collector — fetchRepoMetadata & smart cleanReadmeText", () => {
  it("fetches repo metadata including homepage and handles 404 safely", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          id: 99,
          name: "open-webui",
          full_name: "open-webui/open-webui",
          html_url: "https://github.com/open-webui/open-webui",
          homepage: "https://openwebui.com",
          description: "User-friendly AI Interface",
          stargazers_count: 50000,
          language: "Python",
          pushed_at: "2026-11-22T10:00:00Z",
          archived: false,
          topics: ["llm", "webui"],
        }),
      )
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    const found = await fetchRepoMetadata("open-webui/open-webui", {
      fetchImpl: fetchMock,
    });
    expect(found).toMatchObject({
      id: 99,
      full_name: "open-webui/open-webui",
      homepage: "https://openwebui.com",
      topics: ["llm", "webui"],
    });

    const missing = await fetchRepoMetadata("acme/deleted-repo", {
      fetchImpl: fetchMock,
    });
    expect(missing).toBeNull();
  });

  it("decodes base64 README, strips HTML/SVG/picture/badges/language bars/TOC, and caps at 2500 chars", async () => {
    const noisyMarkdown = [
      "<!-- hidden build comment -->",
      '<div align="center">',
      '<picture><source srcset="dark.png"><img src="https://example.com/logo.png" width="120" /></picture>',
      '<svg viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>',
      "<h1>Awesome Utility</h1>",
      "</div>",
      "[English](README.md) | [简体中文](README.zh.md) | [日本語](README.ja.md) | [한국어](README.ko.md)",
      "[![Build Status](https://img.shields.io/badge/build-passing-green)](https://ci.example.com)",
      "[![License][license-badge]][license-link]",
      "![Screenshot](https://example.com/screenshot.png)",
      "<script>alert('xss')</script>",
      "## Table of Contents",
      "- [Features](#features)",
      "- [Installation](#installation)",
      "Fast CLI tool   for\n\ntesting   REST APIs.   ",
      "A".repeat(3000),
      "[license-badge]: https://img.shields.io/badge/license-MIT-blue",
    ].join("\n");

    const base64Content = Buffer.from(noisyMarkdown, "utf-8").toString(
      "base64",
    );

    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          sha: "abc123def456",
          encoding: "base64",
          content: `${base64Content.slice(0, 20)}\n${base64Content.slice(20)}`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await fetchCleanReadme("acme/cool-tool", {
      token: "ghp_readme_token",
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/acme/cool-tool/readme",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(result.sha).toBe("abc123def456");
    expect(result.text.length).toBe(MAX_README_LENGTH);
    expect(result.text).not.toContain("<");
    expect(result.text).not.toContain("shields.io");
    expect(result.text).not.toContain("screenshot.png");
    expect(result.text).not.toContain("hidden build comment");
    expect(result.text).not.toContain("Table of Contents");
    expect(result.text).not.toContain("简体中文");
    expect(result.text).not.toContain("alert");
    expect(result.text).not.toMatch(/\s{2,}/);
    expect(
      result.text.startsWith(
        "Awesome Utility Fast CLI tool for testing REST APIs.",
      ),
    ).toBe(true);
  });

  it("prioritizes Intro, Features, and Installation sections ahead of long filler sections when > 2500 chars", () => {
    const longReadme = [
      "# MyApp Self-hosted Tool",
      "Open-source privacy-first dashboard.",
      "## Sponsors",
      "Sponsor details ".repeat(180),
      "## Features",
      "Supports Web UI, Docker Compose, SSO, and Prometheus metrics.",
      "## Installation",
      "Run `docker compose up -d` to launch immediately.",
    ].join("\n\n");

    const cleaned = cleanReadmeText(longReadme);
    expect(cleaned.length).toBeLessThanOrEqual(MAX_README_LENGTH);
    expect(cleaned).toContain("Open-source privacy-first dashboard.");
    expect(cleaned).toContain("Supports Web UI, Docker Compose");
    expect(cleaned).toContain("docker compose up -d");
  });

  it("handles cleanReadmeText edge cases under 2500 characters", () => {
    const cleaned = cleanReadmeText(
      "## Title\n\n[![CI](https://badgen.net/ci/ok)](https://ci.test)\n<p>Hello   World</p>",
    );
    expect(cleaned).toBe("## Title Hello World");
  });

  it("returns { sha: null, text: '' } safely when README returns 404", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
      });
    });

    const result = await fetchCleanReadme("acme/no-readme-repo", {
      token: "ghp_readme_token",
      fetchImpl: fetchMock,
    });

    expect(result).toEqual({ sha: null, text: "" });
  });
});
