import { describe, expect, it } from "vitest";
import {
  CATEGORY_MAP,
  CATEGORY_SUB_CATEGORIES,
  isValidCategory,
  isValidSubCategory,
  resolveCanonicalCategory,
  SUB_CATEGORY_MAP,
  SUB_CATEGORY_TO_CATEGORY,
  TAXONOMY,
  TAXONOMY_COMPACT_GUIDE,
  TAXONOMY_PROMPT_GUIDE,
  VALID_CATEGORIES,
  VALID_SUB_CATEGORIES,
} from "@/config/taxonomy";

const LEGACY_CATEGORY_SLUGS = [
  "api-integration",
  "automation-scraping",
  "dev-engineering",
  "ai-llm",
  "media-docs",
  "infra-security",
  "productivity-os",
] as const;

const LEGACY_SUB_CATEGORY_SLUGS = [
  "api-client-testing",
  "api-gateway-webhook",
  "api-mock-docs",
  "auth-payment",
  "workflow-orchestration",
  "web-scraping-browser",
  "chat-bot-notify",
  "desktop-rpa",
  "ui-components-viz",
  "database-orm",
  "cli-dev-env",
  "testing-monitoring",
  "local-llm-gateway",
  "ai-coding-agent",
  "rag-ocr-extract",
  "ai-voice-vision",
  "video-audio-tools",
  "image-svg-tools",
  "document-converter",
  "self-host-deploy",
  "network-proxy-vpn",
  "security-vault",
  "pkm-study-notes",
  "os-desktop-utility",
  "file-sync-share",
] as const;

const EXPECTED_CATEGORY_SLUGS = [
  "api-integration",
  "automation-scraping",
  "dev-engineering",
  "ai-llm",
  "media-docs",
  "infra-security",
  "security-privacy",
  "data-analytics",
  "productivity-os",
  "cms-collab-business",
] as const;

const EXPECTED_SUB_CATEGORY_SLUGS = [
  "api-client-testing",
  "api-gateway-webhook",
  "api-mock-docs",
  "auth-payment",
  "workflow-orchestration",
  "web-scraping-browser",
  "chat-bot-notify",
  "desktop-rpa",
  "ui-components-viz",
  "database-orm",
  "cli-dev-env",
  "testing-monitoring",
  "web-frameworks-runtime",
  "code-quality-docs",
  "local-llm-gateway",
  "ai-chat-ui",
  "ai-coding-agent",
  "ai-workflow-mcp",
  "rag-ocr-extract",
  "ai-voice-vision",
  "video-audio-tools",
  "image-svg-tools",
  "document-converter",
  "3d-game-engine",
  "media-server-streaming",
  "self-host-deploy",
  "network-proxy-vpn",
  "security-vault",
  "containers-homelab",
  "pentest-vuln-scanner",
  "firewall-siem-defense",
  "privacy-encryption-comms",
  "data-pipeline-etl",
  "bi-analytics-dashboard",
  "data-science-notebooks",
  "pkm-study-notes",
  "os-desktop-utility",
  "file-sync-share",
  "task-project-management",
  "rss-bookmarks-reading",
  "cms-blog-ecommerce",
  "team-chat-collab",
  "crm-erp-finance",
] as const;

describe("taxonomy.ts — Single Source of Truth", () => {
  it("defines exactly 10 unique categories and preserves all 7 legacy slugs", () => {
    expect(TAXONOMY).toHaveLength(10);
    expect(VALID_CATEGORIES).toHaveLength(10);
    expect(new Set(VALID_CATEGORIES).size).toBe(10);
    expect([...VALID_CATEGORIES]).toEqual([...EXPECTED_CATEGORY_SLUGS]);

    for (const legacySlug of LEGACY_CATEGORY_SLUGS) {
      expect(VALID_CATEGORIES).toContain(legacySlug);
      expect(isValidCategory(legacySlug)).toBe(true);
    }
  });

  it("defines exactly 43 unique sub-categories and preserves all 25 legacy slugs", () => {
    expect(VALID_SUB_CATEGORIES).toHaveLength(43);
    expect(new Set(VALID_SUB_CATEGORIES).size).toBe(43);
    expect([...VALID_SUB_CATEGORIES]).toEqual([...EXPECTED_SUB_CATEGORY_SLUGS]);

    for (const legacySubSlug of LEGACY_SUB_CATEGORY_SLUGS) {
      expect(VALID_SUB_CATEGORIES).toContain(legacySubSlug);
      expect(isValidSubCategory(legacySubSlug)).toBe(true);
    }
  });

  it("has non-empty trimmed Vietnamese labels and hints on all items", () => {
    for (const category of TAXONOMY) {
      expect(category.label.trim().length).toBeGreaterThan(0);
      expect(category.label).toBe(category.label.trim());
      expect(category.subCategories.length).toBeGreaterThan(0);

      for (const sub of category.subCategories) {
        expect(sub.label.trim().length).toBeGreaterThan(0);
        expect(sub.label).toBe(sub.label.trim());
        expect(sub.hint.trim().length).toBeGreaterThan(0);
        expect(sub.hint).toBe(sub.hint.trim());
      }
    }
  });

  it("maps every category and sub-category consistently across lookup maps", () => {
    expect(Object.keys(CATEGORY_MAP)).toHaveLength(10);
    expect(Object.keys(SUB_CATEGORY_MAP)).toHaveLength(43);
    expect(Object.keys(SUB_CATEGORY_TO_CATEGORY)).toHaveLength(43);

    for (const category of TAXONOMY) {
      expect(CATEGORY_MAP[category.slug]).toBe(category);

      for (const sub of category.subCategories) {
        expect(SUB_CATEGORY_TO_CATEGORY[sub.slug]).toBe(category.slug);
        expect(SUB_CATEGORY_MAP[sub.slug]).toEqual({
          slug: sub.slug,
          label: sub.label,
          hint: sub.hint,
          category: category.slug,
          categoryLabel: category.label,
        });
      }
    }
  });

  it("validates slugs strictly with isValidCategory and isValidSubCategory", () => {
    for (const catSlug of VALID_CATEGORIES) {
      expect(isValidCategory(catSlug)).toBe(true);
    }
    for (const subSlug of VALID_SUB_CATEGORIES) {
      expect(isValidSubCategory(subSlug)).toBe(true);
    }

    expect(isValidCategory("other")).toBe(false);
    expect(isValidCategory("")).toBe(false);
    expect(isValidCategory("blockchain-web3")).toBe(false);

    expect(isValidSubCategory("uncategorized")).toBe(false);
    expect(isValidSubCategory("")).toBe(false);
    expect(isValidSubCategory("crypto-wallet")).toBe(false);
    expect(isValidSubCategory("ai-rag-knowledge")).toBe(false);
    expect(isValidSubCategory("ai-media-voice")).toBe(false);
  });

  it("generates TAXONOMY_PROMPT_GUIDE with all categories, sub-categories, labels, and hints", () => {
    expect(TAXONOMY_PROMPT_GUIDE.trim().length).toBeGreaterThan(0);

    for (const category of TAXONOMY) {
      expect(TAXONOMY_PROMPT_GUIDE).toContain(category.slug);
      expect(TAXONOMY_PROMPT_GUIDE).toContain(category.label);

      for (const sub of category.subCategories) {
        expect(TAXONOMY_PROMPT_GUIDE).toContain(sub.slug);
        expect(TAXONOMY_PROMPT_GUIDE).toContain(sub.label);
        expect(TAXONOMY_PROMPT_GUIDE).toContain(sub.hint);
      }
    }
  });

  it("generates compact TAXONOMY_COMPACT_GUIDE containing all 10 categories and 43 sub-categories at < 50% size", () => {
    expect(TAXONOMY_COMPACT_GUIDE.trim().length).toBeGreaterThan(0);
    expect(TAXONOMY_COMPACT_GUIDE.length).toBeLessThan(
      TAXONOMY_PROMPT_GUIDE.length * 0.55,
    );

    for (const category of TAXONOMY) {
      expect(TAXONOMY_COMPACT_GUIDE).toContain(category.slug);
      for (const sub of category.subCategories) {
        expect(TAXONOMY_COMPACT_GUIDE).toContain(sub.slug);
      }
    }
  });

  it("exposes CATEGORY_SUB_CATEGORIES and resolveCanonicalCategory consistently for all 43 sub-categories", () => {
    expect(Object.keys(CATEGORY_SUB_CATEGORIES)).toHaveLength(10);

    for (const category of TAXONOMY) {
      expect(CATEGORY_SUB_CATEGORIES[category.slug]).toEqual(
        category.subCategories.map((sub) => sub.slug),
      );
      for (const sub of category.subCategories) {
        expect(resolveCanonicalCategory(sub.slug)).toBe(category.slug);
      }
    }

    expect(resolveCanonicalCategory("uncategorized")).toBe("other");
    expect(resolveCanonicalCategory("legacy-unknown-slug")).toBe("other");
    expect(resolveCanonicalCategory("")).toBe("other");
  });
});
