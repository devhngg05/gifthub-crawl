import { describe, expect, it } from "vitest";
import {
  buildCuratedToolkits,
  buildNewsfeedData,
  buildNewsfeedHighlight,
  buildNewsfeedUrl,
  computeIntrinsicScore,
  computeQualityRating,
  computeRadarScore,
  NEWSFEED_TABS,
  parseNewsfeedParams,
  selectDiverseTools,
  type NewsfeedToolRow,
} from "@/lib/newsfeed";

const NOW = new Date("2026-11-23T09:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

let nextId = 1;
function makeTool(overrides: Partial<NewsfeedToolRow> = {}): NewsfeedToolRow {
  const id = overrides.id ?? nextId++;
  return {
    id,
    githubId: 100000 + id,
    name: `tool-${id}`,
    fullName: `org/tool-${id}`,
    htmlUrl: `https://github.com/org/tool-${id}`,
    stars: 2000,
    language: "TypeScript",
    lastPushedAt: daysAgo(2),
    readmeSha: `sha-${id}`,
    summaryVi: `Công cụ thử nghiệm số ${id} phục vụ quy trình tự động hóa.`,
    category: "dev-engineering",
    subCategory: "cli-dev-env",
    secondarySubCategories: [],
    useCases: ["Tự động hóa"],
    replaces: [],
    usability: "cli-tool",
    isPinned: false,
    userNotes: null,
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
    ...overrides,
  };
}

describe("computeRadarScore", () => {
  it("cân bằng log-scale để repo sôi động 5k sao vượt repo 100k sao cũ kỹ", () => {
    const fresh5k = makeTool({
      stars: 5000,
      lastPushedAt: daysAgo(2),
      createdAt: daysAgo(1),
      usability: "app-ready",
      replaces: ["Zapier"],
    });
    const stale100k = makeTool({
      stars: 100000,
      lastPushedAt: daysAgo(150),
      createdAt: daysAgo(120),
      usability: "dev-required",
      replaces: [],
    });

    expect(computeRadarScore(fresh5k, NOW)).toBeGreaterThan(
      computeRadarScore(stale100k, NOW),
    );
  });

  it("tính đúng các bậc điểm push recency, created freshness, usability, replaces và phạt uncategorized", () => {
    const base = makeTool({
      stars: 999, // log10(1000) * 18 = 54
      lastPushedAt: daysAgo(120),
      createdAt: daysAgo(30),
      usability: "dev-required",
      replaces: ["   "], // rỗng sau trim không được cộng
      category: "dev-engineering",
      subCategory: "cli-dev-env",
    });

    // 54 + 0 + 0 + 4 + 0 = 58
    expect(computeRadarScore(base, NOW)).toBe(58);

    // Push tiers: <=7 (+28), <=14 (+20), <=30 (+12), <=90 (+4)
    expect(
      computeRadarScore({ ...base, lastPushedAt: daysAgo(7) }, NOW),
    ).toBe(58 + 28);
    expect(
      computeRadarScore({ ...base, lastPushedAt: daysAgo(14) }, NOW),
    ).toBe(58 + 20);
    expect(
      computeRadarScore({ ...base, lastPushedAt: daysAgo(30) }, NOW),
    ).toBe(58 + 12);
    expect(
      computeRadarScore({ ...base, lastPushedAt: daysAgo(90) }, NOW),
    ).toBe(58 + 4);

    // Created freshness tiers: <=3 (+16), <=7 (+10), <=14 (+5)
    expect(computeRadarScore({ ...base, createdAt: daysAgo(3) }, NOW)).toBe(
      58 + 16,
    );
    expect(computeRadarScore({ ...base, createdAt: daysAgo(7) }, NOW)).toBe(
      58 + 10,
    );
    expect(computeRadarScore({ ...base, createdAt: daysAgo(14) }, NOW)).toBe(
      58 + 5,
    );

    // Usability & replaces
    expect(
      computeRadarScore(
        { ...base, usability: "cli-tool", replaces: ["Postman"] },
        NOW,
      ),
    ).toBe(58 + 4 + 10);
    expect(
      computeRadarScore(
        { ...base, usability: "app-ready", replaces: ["Notion"] },
        NOW,
      ),
    ).toBe(58 + 8 + 10);

    // Penalty for uncategorized (both DB style category='other'+subCategory='uncategorized' and explicit category='uncategorized')
    expect(
      computeRadarScore(
        { ...base, category: "other", subCategory: "uncategorized" },
        NOW,
      ),
    ).toBe(58 - 25);
    expect(
      computeRadarScore(
        { ...base, category: "uncategorized", subCategory: "cli-dev-env" },
        NOW,
      ),
    ).toBe(58 - 25);
  });
});

describe("selectDiverseTools", () => {
  it("giới hạn tối đa maxPerCategory ở lượt chọn đầu và backfill đủ limit theo điểm", () => {
    const scored = [
      { tool: makeTool({ id: 1, category: "ai-llm" }), radarScore: 100 },
      { tool: makeTool({ id: 2, category: "ai-llm" }), radarScore: 98 },
      { tool: makeTool({ id: 3, category: "ai-llm" }), radarScore: 96 },
      { tool: makeTool({ id: 4, category: "ai-llm" }), radarScore: 94 },
      { tool: makeTool({ id: 5, category: "security-privacy" }), radarScore: 90 },
      { tool: makeTool({ id: 6, category: "data-analytics" }), radarScore: 88 },
    ];

    // Cap = 2: picks top 2 ai-llm (1, 2), then security (5), data (6), then backfills ai-llm (3) to reach 5
    const picked = selectDiverseTools(scored, 5, 2);
    expect(picked.map((x) => x.tool.id)).toEqual([1, 2, 5, 6, 3]);
    expect(selectDiverseTools([], 5, 2)).toEqual([]);
    expect(selectDiverseTools(scored, 0, 2)).toEqual([]);
  });
});

describe("buildNewsfeedHighlight", () => {
  it("tạo nhãn lý do đúng theo tab và cắt gọn tên replaces dài hơn 22 ký tự", () => {
    const toolShortReplace = makeTool({
      replaces: ["Notion"],
      usability: "app-ready",
    });
    expect(buildNewsfeedHighlight(toolShortReplace, "spotlight", NOW)).toBe(
      "Thay thế Notion",
    );
    expect(buildNewsfeedHighlight(toolShortReplace, "alternatives", NOW)).toBe(
      "Thay thế Notion",
    );

    const toolLongReplace = makeTool({
      replaces: ["Commercial Enterprise Platform Suite"],
    });
    const longBadge = buildNewsfeedHighlight(
      toolLongReplace,
      "alternatives",
      NOW,
    );
    expect(longBadge).toBe("Thay thế Commercial Enterprise…");

    const gemTool = makeTool({
      stars: 1200,
      lastPushedAt: daysAgo(10),
      createdAt: daysAgo(20),
      replaces: [],
    });
    expect(buildNewsfeedHighlight(gemTool, "gems", NOW)).toBe("Tiềm năng");
    expect(buildNewsfeedHighlight(gemTool, "spotlight", NOW)).toBe(
      "Tiềm năng",
    );
    expect(NEWSFEED_TABS.find((t) => t.id === "gems")?.label).toBe("Tiềm năng");

    const freshTool = makeTool({ createdAt: daysAgo(2), replaces: [] });
    expect(buildNewsfeedHighlight(freshTool, "fresh", NOW)).toBe(
      "Mới vào radar",
    );
    expect(buildNewsfeedHighlight(freshTool, "spotlight", NOW)).toBe(
      "Mới vào radar",
    );

    const readyCli = makeTool({ usability: "cli-tool", replaces: [] });
    const readyApp = makeTool({ usability: "app-ready", replaces: [] });
    expect(buildNewsfeedHighlight(readyCli, "ready", NOW)).toBe("CLI dùng ngay");
    expect(buildNewsfeedHighlight(readyApp, "ready", NOW)).toBe("Dùng ngay");

    const oldFamous = makeTool({
      stars: 40000,
      lastPushedAt: daysAgo(40),
      createdAt: daysAgo(100),
      usability: "dev-required",
      replaces: [],
    });
    expect(buildNewsfeedHighlight(oldFamous, "spotlight", NOW)).toBe(
      "Đang rất nổi bật",
    );
  });
});

describe("parseNewsfeedParams & buildNewsfeedUrl", () => {
  it("chuẩn hóa tham số, bỏ giá trị sai, hỗ trợ quality=high|top và tự xóa usability=dev-required khi chọn tab ready", () => {
    expect(parseNewsfeedParams({})).toEqual({
      tab: "spotlight",
      window: "30d",
      category: undefined,
      usability: undefined,
      quality: undefined,
    });

    expect(
      parseNewsfeedParams({
        tab: ["gems", "fresh"],
        window: "7d",
        category: "ai-llm",
        usability: "app-ready",
        quality: "high",
      }),
    ).toEqual({
      tab: "gems",
      window: "7d",
      category: "ai-llm",
      usability: "app-ready",
      quality: "high",
    });

    expect(parseNewsfeedParams({ quality: "top" }).quality).toBe("top");

    // Rejects invalid values and clears dev-required on tab=ready
    expect(
      parseNewsfeedParams({
        tab: "ready",
        window: "999d",
        category: "nonexistent",
        usability: "dev-required",
        quality: "invalid-tier",
      }),
    ).toEqual({
      tab: "ready",
      window: "30d",
      category: undefined,
      usability: undefined,
      quality: undefined,
    });

    const current = parseNewsfeedParams({
      tab: "spotlight",
      window: "30d",
      usability: "dev-required",
      category: "ai-llm",
      quality: "high",
    });
    // Switching to ready strips dev-required automatically while preserving quality
    expect(buildNewsfeedUrl(current, { tab: "ready" })).toBe(
      "/newsfeed?tab=ready&category=ai-llm&quality=high",
    );
    expect(buildNewsfeedUrl(current, { quality: "top" })).toBe(
      "/newsfeed?category=ai-llm&usability=dev-required&quality=top",
    );
    expect(
      buildNewsfeedUrl(current, { usability: undefined, quality: "top" }),
    ).toBe("/newsfeed?category=ai-llm&quality=top");
    // Resetting to defaults gives clean /newsfeed
    expect(
      buildNewsfeedUrl(current, {
        tab: "spotlight",
        window: "30d",
        category: undefined,
        usability: undefined,
        quality: undefined,
      }),
    ).toBe("/newsfeed");
  });
});

describe("computeIntrinsicScore & computeQualityRating", () => {
  it("không cộng điểm createdAt vào điểm nội tại để tránh lạm phát 3 sao cho repo mới cào", () => {
    const brandNewSmall = makeTool({
      stars: 400,
      lastPushedAt: daysAgo(5),
      createdAt: daysAgo(1),
      usability: "cli-tool",
      replaces: [],
    });
    const olderSameStats = makeTool({
      stars: 400,
      lastPushedAt: daysAgo(5),
      createdAt: daysAgo(120),
      usability: "cli-tool",
      replaces: [],
    });

    expect(computeIntrinsicScore(brandNewSmall, NOW)).toBe(
      computeIntrinsicScore(olderSameStats, NOW),
    );
    expect(computeRadarScore(brandNewSmall, NOW)).toBeGreaterThan(
      computeIntrinsicScore(brandNewSmall, NOW),
    );
    expect(computeQualityRating(brandNewSmall, NOW).tier).toBe(2);
  });

  it("phân tầng chính xác 0 / 1 / 2 / 3 sao theo điểm nội tại và ngưỡng bảo vệ biên", () => {
    // Tier 3 Nhánh A: stars >= 3000, pushed <= 30d, intrinsicScore >= 92
    const tier3ByStars = makeTool({
      stars: 3000,
      lastPushedAt: daysAgo(7),
      usability: "cli-tool",
      replaces: [],
    });
    expect(computeQualityRating(tier3ByStars, NOW)).toMatchObject({
      tier: 3,
      label: "Xuất sắc",
    });

    // Tier 3 Nhánh B1: stars >= 1000 & app-ready
    const tier3AppReady = makeTool({
      stars: 1000,
      lastPushedAt: daysAgo(7),
      usability: "app-ready",
      replaces: [],
    });
    expect(computeQualityRating(tier3AppReady, NOW).tier).toBe(3);

    // Tier 3 Nhánh B2: stars >= 1000 & có replaces (dù cli-tool)
    const tier3WithReplaces = makeTool({
      stars: 1000,
      lastPushedAt: daysAgo(7),
      usability: "cli-tool",
      replaces: ["Postman"],
    });
    expect(computeQualityRating(tier3WithReplaces, NOW).tier).toBe(3);

    // Biên rớt xuống Tier 2: 2999 sao không app-ready và không replaces
    const borderUnder3k = makeTool({
      stars: 2999,
      lastPushedAt: daysAgo(7),
      usability: "cli-tool",
      replaces: [],
    });
    expect(computeQualityRating(borderUnder3k, NOW)).toMatchObject({
      tier: 2,
      label: "Chất lượng cao",
    });

    // Biên rớt xuống Tier 2: 999 sao dù app-ready và có replaces
    const borderUnder1k = makeTool({
      stars: 999,
      lastPushedAt: daysAgo(7),
      usability: "app-ready",
      replaces: ["Notion"],
    });
    expect(computeQualityRating(borderUnder1k, NOW).tier).toBe(2);

    // Biên quá 30 ngày không thể lên 3 sao -> tối đa 2 sao
    const pushed31Days = makeTool({
      stars: 12400,
      lastPushedAt: daysAgo(31),
      usability: "app-ready",
      replaces: ["Notion"],
    });
    expect(computeQualityRating(pushed31Days, NOW).tier).toBe(2);

    // Tier 2 thông thường (intrinsicScore >= 72, <= 90d)
    const tier2Regular = makeTool({
      stars: 500,
      lastPushedAt: daysAgo(14),
      usability: "cli-tool",
      replaces: [],
    });
    expect(computeQualityRating(tier2Regular, NOW)).toMatchObject({
      tier: 2,
      label: "Chất lượng cao",
    });

    // Repo quá 90 ngày dù sao cao vẫn bị chặn ở Tier 1 (intrinsicScore >= 55)
    const staleFamous = makeTool({
      stars: 50000,
      lastPushedAt: daysAgo(91),
      usability: "dev-required",
      replaces: [],
    });
    expect(computeQualityRating(staleFamous, NOW)).toMatchObject({
      tier: 1,
      label: "Đáng chú ý",
    });

    // Tier 0: điểm nội tại < 55
    const lowScore = makeTool({
      stars: 100,
      lastPushedAt: daysAgo(120),
      usability: "dev-required",
      replaces: [],
    });
    expect(computeQualityRating(lowScore, NOW)).toEqual({
      tier: 0,
      label: "",
      reasons: [],
    });
  });

  it("chặn repo uncategorized luôn ở 0 sao và sinh đúng 2-3 lý do tiếng Việt", () => {
    const uncatDbStyle = makeTool({
      stars: 50000,
      lastPushedAt: daysAgo(1),
      usability: "app-ready",
      replaces: ["Notion"],
      category: "other",
      subCategory: "uncategorized",
    });
    const uncatCategory = makeTool({
      stars: 50000,
      lastPushedAt: daysAgo(1),
      category: "uncategorized",
      subCategory: "cli-dev-env",
    });

    expect(computeQualityRating(uncatDbStyle, NOW)).toEqual({
      tier: 0,
      label: "",
      reasons: [],
    });
    expect(computeQualityRating(uncatCategory, NOW)).toEqual({
      tier: 0,
      label: "",
      reasons: [],
    });

    const richReasonsTool = makeTool({
      stars: 12400,
      lastPushedAt: daysAgo(4),
      usability: "app-ready",
      replaces: [],
    });
    expect(computeQualityRating(richReasonsTool, NOW)).toEqual({
      tier: 3,
      label: "Xuất sắc",
      reasons: ["12.4k sao GitHub", "Cập nhật 4 ngày trước", "Cài là dùng ngay"],
    });

    const todayReplaceTool = makeTool({
      stars: 12400,
      lastPushedAt: NOW,
      usability: "app-ready",
      replaces: ["Notion"],
    });
    expect(computeQualityRating(todayReplaceTool, NOW).reasons).toEqual([
      "12.4k sao GitHub",
      "Cập nhật hôm nay",
      "Thay thế Notion",
    ]);

    const staleTier1Tool = makeTool({
      stars: 50000,
      lastPushedAt: daysAgo(120),
      usability: "dev-required",
      replaces: [],
    });
    const staleReasons = computeQualityRating(staleTier1Tool, NOW).reasons;
    expect(staleReasons).toHaveLength(2);
    expect(staleReasons[0]).toBe("50k sao GitHub");
    expect(staleReasons[1]).toMatch(/^Điểm chất lượng \d+$/);
  });
});

describe("buildNewsfeedData", () => {
  it("lọc đúng 5 tab, biên tab Tiềm năng (gems) và tự nới lỏng window sang all khi khung chọn bị rỗng", () => {
    const tools: NewsfeedToolRow[] = [
      makeTool({
        id: 10,
        name: "gem-valid",
        stars: 300,
        lastPushedAt: daysAgo(45),
        createdAt: daysAgo(40),
        usability: "app-ready",
        category: "productivity-os",
        subCategory: "pkm-study-notes",
        replaces: ["Notion"],
      }),
      makeTool({
        id: 11,
        name: "gem-too-few-stars",
        stars: 299,
        lastPushedAt: daysAgo(5),
        createdAt: daysAgo(5),
        usability: "app-ready",
        category: "productivity-os",
        subCategory: "pkm-study-notes",
      }),
      makeTool({
        id: 12,
        name: "gem-too-many-stars",
        stars: 6001,
        lastPushedAt: daysAgo(5),
        createdAt: daysAgo(5),
        usability: "app-ready",
        category: "dev-engineering",
        subCategory: "cli-dev-env",
      }),
      makeTool({
        id: 13,
        name: "gem-stale-46d",
        stars: 2000,
        lastPushedAt: daysAgo(46),
        createdAt: daysAgo(50),
        usability: "cli-tool",
        category: "dev-engineering",
        subCategory: "cli-dev-env",
      }),
      makeTool({
        id: 14,
        name: "uncat-fresh",
        stars: 1500,
        lastPushedAt: daysAgo(1),
        createdAt: daysAgo(1),
        category: "other",
        subCategory: "uncategorized",
        usability: "app-ready",
      }),
      makeTool({
        id: 15,
        name: "alt-cli-high",
        stars: 50000,
        lastPushedAt: daysAgo(1),
        createdAt: daysAgo(20),
        usability: "cli-tool",
        category: "api-integration",
        subCategory: "api-client-testing",
        replaces: ["Postman"],
      }),
      makeTool({
        id: 16,
        name: "dev-only-tool",
        stars: 8000,
        lastPushedAt: daysAgo(3),
        createdAt: daysAgo(3),
        usability: "dev-required",
        category: "dev-engineering",
        subCategory: "web-frameworks-runtime",
      }),
    ];

    // Gems with window=all checks 300..6000 & <=45d & not uncategorized
    const gemsData = buildNewsfeedData(
      tools,
      { tab: "gems", window: "all" },
      NOW,
    );
    expect(gemsData.items.map((i) => i.tool.name)).toEqual(["gem-valid"]);
    expect(gemsData.pulse.activeGems).toBe(1);

    // Gems with window=7d yields 0 (gem-valid was pushed 45d ago) -> relaxes to all
    const relaxedGems = buildNewsfeedData(
      tools,
      { tab: "gems", window: "7d" },
      NOW,
    );
    expect(relaxedGems.didRelaxWindow).toBe(true);
    expect(relaxedGems.effectiveWindow).toBe("all");
    expect(relaxedGems.items.map((i) => i.tool.name)).toEqual(["gem-valid"]);

    // Alternatives prioritizes app-ready over higher-star cli-tool
    const altData = buildNewsfeedData(
      tools,
      { tab: "alternatives", window: "all" },
      NOW,
    );
    expect(altData.items.map((i) => i.tool.name)).toEqual([
      "gem-valid",
      "alt-cli-high",
    ]);

    // Ready excludes dev-required and uncategorized
    const readyData = buildNewsfeedData(
      tools,
      { tab: "ready", window: "all" },
      NOW,
    );
    const readyNames = readyData.items.map((i) => i.tool.name);
    expect(readyNames).not.toContain("dev-only-tool");
    expect(readyNames).not.toContain("uncat-fresh");
    expect(readyNames).toContain("gem-valid");
    expect(readyNames).toContain("alt-cli-high");

    // Fresh sorts createdAt DESC and excludes uncategorized
    const freshData = buildNewsfeedData(
      tools,
      { tab: "fresh", window: "all" },
      NOW,
    );
    expect(freshData.items[0]?.tool.name).toBe("dev-only-tool");
    expect(freshData.items.map((i) => i.tool.name)).not.toContain(
      "uncat-fresh",
    );
  });

  it("lọc đúng theo quality=high (tier >= 2) và quality=top (tier === 3) kèm tabCounts và pulse.topRatedCount", () => {
    const tools: NewsfeedToolRow[] = [
      makeTool({
        id: 501,
        name: "top-tier-3",
        stars: 12000,
        lastPushedAt: daysAgo(2),
        createdAt: daysAgo(20),
        usability: "app-ready",
        replaces: ["Notion"],
      }),
      makeTool({
        id: 502,
        name: "high-tier-2",
        stars: 500,
        lastPushedAt: daysAgo(14),
        createdAt: daysAgo(20),
        usability: "cli-tool",
      }),
      makeTool({
        id: 503,
        name: "notable-tier-1",
        stars: 50000,
        lastPushedAt: daysAgo(120),
        createdAt: daysAgo(120),
        usability: "dev-required",
      }),
      makeTool({
        id: 504,
        name: "plain-tier-0",
        stars: 100,
        lastPushedAt: daysAgo(150),
        createdAt: daysAgo(150),
        usability: "dev-required",
      }),
    ];

    const highData = buildNewsfeedData(
      tools,
      { tab: "spotlight", window: "all", quality: "high" },
      NOW,
    );
    expect(highData.pulse.topRatedCount).toBe(1);
    expect(highData.items.map((i) => i.tool.name)).toEqual([
      "top-tier-3",
      "high-tier-2",
    ]);
    expect(highData.tabCounts.spotlight).toBe(2);
    expect(highData.tabCounts.alternatives).toBe(1);

    const topData = buildNewsfeedData(
      tools,
      { tab: "spotlight", window: "all", quality: "top" },
      NOW,
    );
    expect(topData.items.map((i) => i.tool.name)).toEqual(["top-tier-3"]);
    expect(topData.items[0]?.quality.tier).toBe(3);
    expect(topData.tabCounts.spotlight).toBe(1);
    expect(topData.tabCounts.ready).toBe(1);
  });
});

describe("buildCuratedToolkits", () => {
  it("tự động ghép bộ công cụ theo subCategory, ưu tiên đa dạng ngách con và ẩn bộ < 2 công cụ", () => {
    expect(buildCuratedToolkits([], NOW)).toEqual([]);

    const tools: NewsfeedToolRow[] = [
      // Kit 1: local-ai-coding (4 items: 2 in local-llm-gateway, 1 in ai-chat-ui, 1 in ai-coding-agent, 1 via secondary ai-workflow-mcp)
      makeTool({
        id: 101,
        stars: 90000,
        category: "ai-llm",
        subCategory: "local-llm-gateway",
      }),
      makeTool({
        id: 102,
        stars: 80000,
        category: "ai-llm",
        subCategory: "local-llm-gateway",
      }),
      makeTool({
        id: 103,
        stars: 20000,
        category: "ai-llm",
        subCategory: "ai-chat-ui",
      }),
      makeTool({
        id: 104,
        stars: 15000,
        category: "ai-llm",
        subCategory: "ai-coding-agent",
      }),
      makeTool({
        id: 105,
        stars: 5000,
        category: "automation-scraping",
        subCategory: "workflow-orchestration",
        secondarySubCategories: ["ai-workflow-mcp"],
      }),
      // Kit 4: security-privacy only gets 1 tool -> must be hidden
      makeTool({
        id: 201,
        stars: 12000,
        category: "security-privacy",
        subCategory: "pentest-vuln-scanner",
      }),
    ];

    const toolkits = buildCuratedToolkits(tools, NOW);
    const aiKit = toolkits.find((k) => k.id === "local-ai-coding");
    expect(aiKit).toBeDefined();
    expect(aiKit?.shortTitle).toBe("AI Cục bộ");
    expect(aiKit?.totalMatchedCount).toBe(5);
    expect(aiKit?.tools.map((t) => t.id)).toEqual([101, 103, 104, 105]);
    expect(aiKit?.ratedTools).toHaveLength(4);
    expect(aiKit?.ratedTools[0]?.quality.tier).toBe(3);
    expect(aiKit?.targetCategory).toBe("ai-llm");

    // Security kit has < 2 tools so hidden
    expect(toolkits.find((k) => k.id === "security-privacy")).toBeUndefined();
  });
});
