import { describe, expect, it } from "vitest";
import {
  buildToolSearchText,
  normalizeSearchText,
  parseSearchQuery,
  POPULAR_SEARCH_SUGGESTIONS,
} from "@/lib/search-engine";

describe("normalizeSearchText", () => {
  it("normalizes Vietnamese diacritics, maps đ/Đ to d, lowercases, and collapses separators", () => {
    expect(normalizeSearchText("Nối API & Đồng bộ — Open-Source!")).toBe(
      "noi api dong bo open source",
    );
    expect(normalizeSearchText("Đánh giá Công cụ Cào Web / OCR_PDF")).toBe(
      "danh gia cong cu cao web ocr pdf",
    );
    expect(normalizeSearchText("   ")).toBe("");
  });
});

describe("buildToolSearchText", () => {
  it("aggregates repo metadata, userNotes, topics, and positive taxonomy keywords without negative disambiguation phrases", () => {
    const text = buildToolSearchText({
      name: "Vaultwarden",
      fullName: "dani-garcia/vaultwarden",
      language: "Rust",
      summaryVi: "Máy chủ quản lý mật khẩu nhẹ tương thích Bitwarden.",
      category: "infra-security",
      subCategory: "security-vault",
      secondarySubCategories: ["privacy-encryption-comms"],
      useCases: ["Lưu trữ mật khẩu đội nhóm"],
      replaces: ["1Password", "LastPass"],
      userNotes: "Cài bằng Docker Compose cho homelab",
      topics: ["password-manager", "self-hosted"],
    });

    expect(text).toContain("vaultwarden");
    expect(text).toContain("dani garcia vaultwarden");
    expect(text).toContain("rust");
    expect(text).toContain("quan ly mat khau");
    expect(text).toContain("1password");
    expect(text).toContain("homelab");
    expect(text).toContain("password manager");

    // Must NOT include negative clauses from taxonomy prompt hints (like "không dùng cho pentest/WAF...")
    expect(text).not.toContain("khong dung cho");
    expect(text).not.toContain("pentest waf");
    expect(text).not.toContain("chi danh cho");
  });

  it("excludes negative disambiguation clauses for ai-coding-agent and pentest-vuln-scanner", () => {
    const aiText = buildToolSearchText({
      name: "aider",
      fullName: "Aider-AI/aider",
      language: "Python",
      summaryVi: "Trợ lý lập trình AI ngay trong terminal.",
      category: "ai-llm",
      subCategory: "ai-coding-agent",
    });
    expect(aiText).toContain("ai ho tro code lap trinh");
    expect(aiText).not.toContain("khong dung cho app ai noi chung");
    expect(aiText).not.toContain("chi danh cho");

    const secText = buildToolSearchText({
      name: "nuclei",
      fullName: "projectdiscovery/nuclei",
      language: "Go",
      summaryVi: "Công cụ quét lỗ hổng tự động nhanh.",
      category: "security-privacy",
      subCategory: "pentest-vuln-scanner",
    });
    expect(secText).toContain("quet lo hong");
    expect(secText).not.toContain("tru quan ly mat khau");
  });
});

describe("parseSearchQuery — real Vietnamese & English semantic queries", () => {
  it("produces identical bilingual concept groups and API subCategories for 'nối API' and 'noi api'", () => {
    const accented = parseSearchQuery("nối API");
    const unaccented = parseSearchQuery("noi api");

    expect(accented.normalizedQuery).toBe("noi api");
    expect(unaccented.normalizedQuery).toBe("noi api");
    expect(accented.coreTokens).toEqual(["noi", "api"]);
    expect(unaccented.coreTokens).toEqual(["noi", "api"]);
    expect(accented.conceptGroups).toEqual(unaccented.conceptGroups);
    expect(accented.matchedSubCategories).toEqual(
      unaccented.matchedSubCategories,
    );

    expect(accented.conceptGroups).toHaveLength(2);
    expect(accented.conceptGroups[0]).toEqual(
      expect.arrayContaining([
        "noi",
        "ket noi",
        "tich hop",
        "webhook",
        "gateway",
        "connector",
        "integration",
        "workflow",
        "mcp",
      ]),
    );
    expect(accented.conceptGroups[1]).toEqual(
      expect.arrayContaining(["api", "rest", "graphql", "http", "endpoint"]),
    );
    expect(accented.matchedSubCategories).toEqual(
      expect.arrayContaining([
        "api-gateway-webhook",
        "workflow-orchestration",
        "api-client-testing",
        "ai-workflow-mcp",
      ]),
    );
  });

  it("strips soft Vietnamese stopwords while preserving scraping concept & subCategory for 'công cụ cào web miễn phí'", () => {
    const parsed = parseSearchQuery("công cụ cào web miễn phí");

    expect(parsed.coreTokens).toEqual(["cao", "web"]);
    expect(parsed.conceptGroups).toHaveLength(1);
    expect(parsed.conceptGroups[0]).toEqual(
      expect.arrayContaining([
        "cao",
        "cao web",
        "scraping",
        "crawler",
        "playwright",
        "puppeteer",
      ]),
    );
    expect(parsed.matchedSubCategories).toContain("web-scraping-browser");
  });

  it("recognizes replace intent for 'thay thế notion', 'giống postman', and 'alternative to vercel'", () => {
    const notion = parseSearchQuery("thay thế notion");
    expect(notion.isReplaceIntent).toBe(true);
    expect(notion.replaceTarget).toBe("notion");
    expect(notion.coreTokens).toEqual(["notion"]);
    expect(notion.conceptGroups).toEqual([["notion"]]);

    const postman = parseSearchQuery("giống postman");
    expect(postman.isReplaceIntent).toBe(true);
    expect(postman.replaceTarget).toBe("postman");

    const vercel = parseSearchQuery("alternative to vercel");
    expect(vercel.isReplaceIntent).toBe(true);
    expect(vercel.replaceTarget).toBe("vercel");
  });

  it("handles 'chay ai cuc bo', 'quan ly mat khau', typo 'posman', and soft-stopword-only safety", () => {
    const localAi = parseSearchQuery("chay ai cuc bo");
    expect(localAi.coreTokens).toEqual(["ai", "cuc", "bo"]);
    expect(localAi.conceptGroups.flat()).toEqual(
      expect.arrayContaining(["ai", "llm", "local", "cuc bo", "offline", "ollama", "vllm"]),
    );
    expect(localAi.matchedSubCategories).toContain("local-llm-gateway");

    const password = parseSearchQuery("quan ly mat khau");
    expect(password.conceptGroups.flat()).toEqual(
      expect.arrayContaining(["mat khau", "password", "vault", "secrets"]),
    );
    expect(password.matchedSubCategories).toContain("security-vault");

    const typo = parseSearchQuery("posman");
    expect(typo.normalizedQuery).toBe("posman");
    expect(typo.coreTokens).toEqual(["posman"]);
    expect(typo.conceptGroups).toEqual([["posman"]]);

    // Soft-stopword-only input should NOT collapse to empty coreTokens
    const onlyStopword = parseSearchQuery("app");
    expect(onlyStopword.coreTokens).toEqual(["app"]);
    expect(POPULAR_SEARCH_SUGGESTIONS.length).toBeGreaterThanOrEqual(5);
  });
});
