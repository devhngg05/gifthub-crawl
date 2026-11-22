import { describe, expect, it, vi } from "vitest";
import {
  BLOCKED_TOPICS,
  buildGitHubHeaders,
  buildSearchQueries,
  cleanReadmeText,
  fetchCandidateRepos,
  fetchCleanReadme,
  MAX_README_LENGTH,
  passesQualityGate,
  type GitHubRepoItem,
} from "../github";

function makeRepo(overrides: Partial<GitHubRepoItem> = {}): GitHubRepoItem {
  return {
    id: 1,
    name: "cool-tool",
    full_name: "acme/cool-tool",
    html_url: "https://github.com/acme/cool-tool",
    description: "A fast open-source developer utility",
    stargazers_count: 2400,
    language: "TypeScript",
    pushed_at: "2026-11-01T10:00:00Z",
    archived: false,
    topics: ["cli", "automation"],
    ...overrides,
  };
}

describe("github collector — headers & search queries", () => {
  it("builds standard GitHub API headers with optional Bearer token", () => {
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

  it("builds pillar (>6 months) and rising (30 days) search queries accurately", () => {
    const now = new Date("2026-11-22T12:00:00Z");
    const queries = buildSearchQueries(now);

    expect(queries.pillar).toBe(
      "stars:>1500 pushed:>2026-05-22 archived:false",
    );
    expect(queries.rising).toBe(
      "stars:>500 created:>2026-10-23 archived:false",
    );
  });

  it("clamps month overflow safely when subtracting 6 months", () => {
    const now = new Date("2026-08-31T00:00:00Z");
    const queries = buildSearchQueries(now);

    expect(queries.pillar).toBe(
      "stars:>1500 pushed:>2026-02-28 archived:false",
    );
  });
});

describe("github collector — deduplication & quality gate", () => {
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

  it("fetches pillar and rising streams in parallel, deduplicates by repo.id, and enforces quality gate", async () => {
    const sharedRepo = makeRepo({
      id: 101,
      name: "shared-cli",
      full_name: "acme/shared-cli",
    });
    const pillarOnly = makeRepo({
      id: 102,
      name: "pillar-tool",
      full_name: "acme/pillar-tool",
    });
    const risingOnly = makeRepo({
      id: 103,
      name: "rising-tool",
      full_name: "acme/rising-tool",
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
    const blockedTutorial = makeRepo({
      id: 107,
      name: "learn-js",
      full_name: "acme/learn-js",
      topics: ["Tutorial"],
    });

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("pushed%3A%3E")) {
        return new Response(
          JSON.stringify({
            items: [sharedRepo, pillarOnly, blockedAwesome, noDescription],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("created%3A%3E")) {
        return new Response(
          JSON.stringify({
            items: [sharedRepo, risingOnly, archivedRepo, blockedTutorial],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await fetchCandidateRepos({
      now: new Date("2026-11-22T00:00:00Z"),
      token: "ghp_secret_for_test",
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: "Bearer ghp_secret_for_test",
      });
    }

    expect(result.map((r) => r.id)).toEqual([101, 102, 103]);
  });
});

describe("github collector — fetchCleanReadme", () => {
  it("decodes base64 README, strips HTML, badges, markdown images, collapses whitespace, and caps at 2500 chars", async () => {
    const noisyMarkdown = [
      "<!-- hidden build comment -->",
      '<div align="center">',
      '<img src="https://example.com/logo.png" width="120" />',
      "<h1>Awesome Utility</h1>",
      "</div>",
      "[![Build Status](https://img.shields.io/badge/build-passing-green)](https://ci.example.com)",
      "[![License][license-badge]][license-link]",
      "![Screenshot](https://example.com/screenshot.png)",
      "<script>alert('xss')</script>",
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
    expect(result.sha).toBe("abc123def456");
    expect(result.text.length).toBe(MAX_README_LENGTH);
    expect(result.text).not.toContain("<");
    expect(result.text).not.toContain("shields.io");
    expect(result.text).not.toContain("screenshot.png");
    expect(result.text).not.toContain("hidden build comment");
    expect(result.text).not.toContain("alert");
    expect(result.text).not.toMatch(/\s{2,}/);
    expect(result.text.startsWith("Awesome Utility Fast CLI tool for testing REST APIs.")).toBe(true);
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
