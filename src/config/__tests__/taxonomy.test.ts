import { describe, expect, it } from "vitest";
import {
  CATEGORY_MAP,
  isValidCategory,
  isValidSubCategory,
  SUB_CATEGORY_MAP,
  SUB_CATEGORY_TO_CATEGORY,
  TAXONOMY,
  TAXONOMY_PROMPT_GUIDE,
  VALID_CATEGORIES,
  VALID_SUB_CATEGORIES,
} from "@/config/taxonomy";

const EXPECTED_CATEGORY_SLUGS = [
  "api-integration",
  "automation-scraping",
  "dev-engineering",
  "ai-llm",
  "media-docs",
  "infra-security",
  "productivity-os",
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

describe("taxonomy.ts — Single Source of Truth", () => {
  it("defines exactly 7 unique categories matching PRD", () => {
    expect(TAXONOMY).toHaveLength(7);
    expect(VALID_CATEGORIES).toHaveLength(7);
    expect(new Set(VALID_CATEGORIES).size).toBe(7);
    expect([...VALID_CATEGORIES]).toEqual([...EXPECTED_CATEGORY_SLUGS]);
  });

  it("defines exactly 25 unique sub-categories matching PRD", () => {
    expect(VALID_SUB_CATEGORIES).toHaveLength(25);
    expect(new Set(VALID_SUB_CATEGORIES).size).toBe(25);
    expect([...VALID_SUB_CATEGORIES]).toEqual([...EXPECTED_SUB_CATEGORY_SLUGS]);
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
    expect(Object.keys(CATEGORY_MAP)).toHaveLength(7);
    expect(Object.keys(SUB_CATEGORY_MAP)).toHaveLength(25);
    expect(Object.keys(SUB_CATEGORY_TO_CATEGORY)).toHaveLength(25);

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
});
