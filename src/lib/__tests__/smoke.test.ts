import { describe, expect, it } from "vitest";
import {
  SUB_CATEGORY_TO_CATEGORY,
  TAXONOMY,
  VALID_CATEGORIES,
  VALID_SUB_CATEGORIES,
} from "@/config/taxonomy";

describe("Vitest infrastructure smoke test", () => {
  it("resolves @/* path alias to src/* and executes TypeScript", () => {
    expect(Array.isArray(TAXONOMY)).toBe(true);
    expect(Array.isArray(VALID_CATEGORIES)).toBe(true);
    expect(Array.isArray(VALID_SUB_CATEGORIES)).toBe(true);
    expect(typeof SUB_CATEGORY_TO_CATEGORY).toBe("object");
  });
});
