import { describe, expect, it } from "vitest";
import { VALID_SUB_CATEGORIES } from "@/config/taxonomy";
import {
  AiClassificationSchema,
  ToolIdParamSchema,
  ToolPatchSchema,
} from "@/lib/validator";

function makeValidAiPayload(overrides: Record<string, unknown> = {}) {
  return {
    summary_vi:
      "Công cụ CLI giúp kiểm thử và debug API nhanh chóng ngay trên terminal.",
    category: "api-integration",
    sub_category: "api-client-testing",
    secondary_sub_categories: ["api-mock-docs", "cli-dev-env"],
    use_cases: ["Gửi request REST/GraphQL", "Kiểm tra phản hồi JSON"],
    replaces: ["Postman", "Insomnia"],
    usability: "cli-tool",
    ...overrides,
  };
}

describe("AiClassificationSchema", () => {
  it("accepts a complete valid payload and preserves values", () => {
    const payload = makeValidAiPayload();
    const parsed = AiClassificationSchema.parse(payload);

    expect(parsed).toEqual({
      summary_vi: payload.summary_vi,
      category: "api-integration",
      sub_category: "api-client-testing",
      secondary_sub_categories: ["api-mock-docs", "cli-dev-env"],
      use_cases: ["Gửi request REST/GraphQL", "Kiểm tra phản hồi JSON"],
      replaces: ["Postman", "Insomnia"],
      usability: "cli-tool",
    });
  });

  describe("summary_vi validation", () => {
    it("accepts boundary lengths of 10 and 500 characters and trims whitespace", () => {
      const len10 = "a".repeat(10);
      const len500 = "b".repeat(500);

      expect(
        AiClassificationSchema.parse(
          makeValidAiPayload({ summary_vi: `  ${len10}  ` }),
        ).summary_vi,
      ).toBe(len10);

      expect(
        AiClassificationSchema.parse(makeValidAiPayload({ summary_vi: len500 }))
          .summary_vi,
      ).toBe(len500);
    });

    it("rejects summary_vi shorter than 10 chars, longer than 500 chars, whitespace-only, missing, null, or non-string", () => {
      const invalidValues: unknown[] = [
        "123456789",
        "b".repeat(501),
        " ".repeat(20),
        "",
        null,
        undefined,
        12345,
      ];

      for (const value of invalidValues) {
        const result = AiClassificationSchema.safeParse(
          makeValidAiPayload({ summary_vi: value }),
        );
        expect(result.success).toBe(false);
      }

      const missingKeyPayload = makeValidAiPayload();
      delete (missingKeyPayload as Record<string, unknown>).summary_vi;
      expect(AiClassificationSchema.safeParse(missingKeyPayload).success).toBe(
        false,
      );
    });
  });

  describe("anti-hallucination for category & sub_category", () => {
    it("trims valid slugs for category and sub_category", () => {
      const parsed = AiClassificationSchema.parse(
        makeValidAiPayload({
          category: "  ai-llm  ",
          sub_category: "  ai-coding-agent ",
        }),
      );

      expect(parsed.category).toBe("ai-llm");
      expect(parsed.sub_category).toBe("ai-coding-agent");
    });

    it("coerces unknown, missing, null, or non-string category to 'other' when sub_category is uncategorized, and auto-syncs category when sub_category is valid", () => {
      for (const badCategory of ["blockchain", "other", "", null, 42]) {
        const uncategorizedParsed = AiClassificationSchema.parse(
          makeValidAiPayload({
            category: badCategory,
            sub_category: "uncategorized",
          }),
        );
        expect(uncategorizedParsed.category).toBe("other");
        expect(uncategorizedParsed.sub_category).toBe("uncategorized");

        const validSubParsed = AiClassificationSchema.parse(
          makeValidAiPayload({
            category: badCategory,
            sub_category: "api-client-testing",
          }),
        );
        expect(validSubParsed.category).toBe("api-integration");
        expect(validSubParsed.sub_category).toBe("api-client-testing");
      }

      const mismatchedParsed = AiClassificationSchema.parse(
        makeValidAiPayload({
          category: "ai-llm",
          sub_category: "pentest-vuln-scanner",
        }),
      );
      expect(mismatchedParsed.category).toBe("security-privacy");
      expect(mismatchedParsed.sub_category).toBe("pentest-vuln-scanner");

      const missingCat = makeValidAiPayload({ sub_category: "uncategorized" });
      delete (missingCat as Record<string, unknown>).category;
      expect(AiClassificationSchema.parse(missingCat).category).toBe("other");
    });

    it("coerces unknown, missing, null, or non-string sub_category to 'uncategorized'", () => {
      for (const badSub of ["hallucinated-sub", "uncategorized", "", null, 99]) {
        const parsed = AiClassificationSchema.parse(
          makeValidAiPayload({ sub_category: badSub }),
        );
        expect(parsed.sub_category).toBe("uncategorized");
      }

      const missingSub = makeValidAiPayload();
      delete (missingSub as Record<string, unknown>).sub_category;
      expect(AiClassificationSchema.parse(missingSub).sub_category).toBe(
        "uncategorized",
      );
    });
  });

  describe("secondary_sub_categories filtering & capping", () => {
    it("filters invalid slugs, removes primary sub_category, deduplicates, and caps at 2 after filtering", () => {
      const parsed = AiClassificationSchema.parse(
        makeValidAiPayload({
          sub_category: "api-client-testing",
          secondary_sub_categories: [
            "api-client-testing",
            "hallucinated-slug",
            "uncategorized",
            "",
            null,
            123,
            "  api-mock-docs  ",
            "api-mock-docs",
            "auth-payment",
            "cli-dev-env",
          ],
        }),
      );

      expect(parsed.secondary_sub_categories).toEqual([
        "api-mock-docs",
        "auth-payment",
      ]);
    });

    it("keeps valid secondary sub-categories even when primary sub_category falls back to 'uncategorized'", () => {
      const parsed = AiClassificationSchema.parse(
        makeValidAiPayload({
          sub_category: "not-in-taxonomy",
          secondary_sub_categories: [
            "uncategorized",
            "database-orm",
            "cli-dev-env",
            "testing-monitoring",
          ],
        }),
      );

      expect(parsed.sub_category).toBe("uncategorized");
      expect(parsed.secondary_sub_categories).toEqual([
        "database-orm",
        "cli-dev-env",
      ]);
    });

    it("defaults missing, null, or non-array secondary_sub_categories to []", () => {
      for (const badValue of [null, "api-mock-docs", { a: 1 }, 42]) {
        const parsed = AiClassificationSchema.parse(
          makeValidAiPayload({ secondary_sub_categories: badValue }),
        );
        expect(parsed.secondary_sub_categories).toEqual([]);
      }

      const missingKey = makeValidAiPayload();
      delete (missingKey as Record<string, unknown>).secondary_sub_categories;
      expect(
        AiClassificationSchema.parse(missingKey).secondary_sub_categories,
      ).toEqual([]);
    });
  });

  describe("use_cases normalization & bounds", () => {
    it("accepts 1 to 4 items, trims, deduplicates, strips blanks/non-strings, and caps at 4", () => {
      const single = AiClassificationSchema.parse(
        makeValidAiPayload({ use_cases: ["  Quản lý container Docker  "] }),
      );
      expect(single.use_cases).toEqual(["Quản lý container Docker"]);

      const fivePlusDirty = AiClassificationSchema.parse(
        makeValidAiPayload({
          use_cases: [
            "",
            "   ",
            123,
            null,
            " Tác vụ 1 ",
            "Tác vụ 1",
            "Tác vụ 2",
            "Tác vụ 3",
            "Tác vụ 4",
            "Tác vụ 5",
          ],
        }),
      );
      expect(fivePlusDirty.use_cases).toEqual([
        "Tác vụ 1",
        "Tác vụ 2",
        "Tác vụ 3",
        "Tác vụ 4",
      ]);
    });

    it("rejects empty, blank-only, non-string-only, missing, null, or non-array use_cases", () => {
      for (const badUseCases of [
        [],
        ["", "   "],
        [123, null, {}],
        null,
        undefined,
        "Tác vụ đơn",
      ]) {
        const result = AiClassificationSchema.safeParse(
          makeValidAiPayload({ use_cases: badUseCases }),
        );
        expect(result.success).toBe(false);
      }

      const missingKey = makeValidAiPayload();
      delete (missingKey as Record<string, unknown>).use_cases;
      expect(AiClassificationSchema.safeParse(missingKey).success).toBe(false);
    });
  });

  describe("replaces normalization & bounds", () => {
    it("accepts 0 to 3 items, defaults missing/null/non-array to [], strips blanks, deduplicates, and caps at 3", () => {
      expect(
        AiClassificationSchema.parse(makeValidAiPayload({ replaces: [] }))
          .replaces,
      ).toEqual([]);

      for (const badReplaces of [null, "Postman", 99]) {
        expect(
          AiClassificationSchema.parse(
            makeValidAiPayload({ replaces: badReplaces }),
          ).replaces,
        ).toEqual([]);
      }

      const missingKey = makeValidAiPayload();
      delete (missingKey as Record<string, unknown>).replaces;
      expect(AiClassificationSchema.parse(missingKey).replaces).toEqual([]);

      const noisy = AiClassificationSchema.parse(
        makeValidAiPayload({
          replaces: [
            "  ",
            null,
            " Postman ",
            "Postman",
            "Insomnia",
            "Bruno",
            "Hoppscotch",
          ],
        }),
      );
      expect(noisy.replaces).toEqual(["Postman", "Insomnia", "Bruno"]);
    });
  });

  describe("usability fallback & extra fields", () => {
    it("accepts all 3 valid usability levels (with trimming)", () => {
      expect(
        AiClassificationSchema.parse(
          makeValidAiPayload({ usability: "app-ready" }),
        ).usability,
      ).toBe("app-ready");
      expect(
        AiClassificationSchema.parse(
          makeValidAiPayload({ usability: "  cli-tool  " }),
        ).usability,
      ).toBe("cli-tool");
      expect(
        AiClassificationSchema.parse(
          makeValidAiPayload({ usability: "dev-required" }),
        ).usability,
      ).toBe("dev-required");
    });

    it("falls back to 'dev-required' for unknown, missing, null, or non-string usability", () => {
      for (const badUsability of ["beginner-friendly", "", null, 123]) {
        expect(
          AiClassificationSchema.parse(
            makeValidAiPayload({ usability: badUsability }),
          ).usability,
        ).toBe("dev-required");
      }

      const missingKey = makeValidAiPayload();
      delete (missingKey as Record<string, unknown>).usability;
      expect(AiClassificationSchema.parse(missingKey).usability).toBe(
        "dev-required",
      );
    });

    it("strips extra properties hallucinated by LLMs", () => {
      const parsed = AiClassificationSchema.parse(
        makeValidAiPayload({
          reasoning: "Model added extra thought process",
          confidence: 0.99,
        }),
      );

      expect("reasoning" in parsed).toBe(false);
      expect("confidence" in parsed).toBe(false);
    });
  });
});

describe("ToolIdParamSchema", () => {
  it("accepts positive integers from string or number", () => {
    expect(ToolIdParamSchema.parse("1")).toBe(1);
    expect(ToolIdParamSchema.parse("42")).toBe(42);
    expect(ToolIdParamSchema.parse(99)).toBe(99);
  });

  it("rejects zero, negatives, floats, blanks, and non-numeric values", () => {
    for (const invalidId of ["0", "-5", "3.14", "abc", "", "   ", NaN]) {
      expect(ToolIdParamSchema.safeParse(invalidId).success).toBe(false);
    }
  });
});

describe("ToolPatchSchema", () => {
  it("accepts individual and combined valid fields", () => {
    expect(ToolPatchSchema.parse({ isPinned: true })).toEqual({
      isPinned: true,
    });
    expect(ToolPatchSchema.parse({ userNotes: null })).toEqual({
      userNotes: null,
    });
    expect(
      ToolPatchSchema.parse({ userNotes: "x".repeat(2000) }),
    ).toEqual({ userNotes: "x".repeat(2000) });

    for (const subSlug of VALID_SUB_CATEGORIES) {
      expect(ToolPatchSchema.parse({ subCategory: subSlug })).toEqual({
        subCategory: subSlug,
      });
    }

    expect(
      ToolPatchSchema.parse({
        isPinned: false,
        userNotes: "Dùng cho dự án nội bộ",
        subCategory: "database-orm",
      }),
    ).toEqual({
      isPinned: false,
      userNotes: "Dùng cho dự án nội bộ",
      subCategory: "database-orm",
    });
  });

  it("rejects empty objects or objects with all undefined values", () => {
    expect(ToolPatchSchema.safeParse({}).success).toBe(false);
    expect(ToolPatchSchema.safeParse({ isPinned: undefined }).success).toBe(
      false,
    );
  });

  it("rejects out-of-spec userNotes lengths and invalid subCategory slugs", () => {
    expect(
      ToolPatchSchema.safeParse({ userNotes: "x".repeat(2001) }).success,
    ).toBe(false);
    expect(
      ToolPatchSchema.safeParse({ subCategory: "uncategorized" }).success,
    ).toBe(false);
    expect(
      ToolPatchSchema.safeParse({ subCategory: "invalid-sub" }).success,
    ).toBe(false);
  });

  it("rejects forbidden extra fields via strict mode", () => {
    for (const forbiddenField of [
      { isBookmarked: true },
      { personalNote: "hello" },
      { status: "active" },
      { customTags: ["ai"] },
      { isPinned: true, extra: "nope" },
    ]) {
      expect(ToolPatchSchema.safeParse(forbiddenField).success).toBe(false);
    }
  });
});
