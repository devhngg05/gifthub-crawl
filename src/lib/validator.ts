import { z } from "zod";
import {
  isValidCategory,
  isValidSubCategory,
  VALID_SUB_CATEGORIES,
  type CategorySlug,
  type SubCategorySlug,
} from "@/config/taxonomy";

export const VALID_USABILITY_LEVELS = [
  "app-ready",
  "cli-tool",
  "dev-required",
] as const;

export type UsabilityLevel = (typeof VALID_USABILITY_LEVELS)[number];

/** Lọc chuỗi hợp lệ (trim, bỏ rỗng), khử trùng lặp theo thứ tự và giới hạn số phần tử. */
function sanitizeStringArray(input: unknown, maxItems: number): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of input) {
    if (typeof item !== "string") {
      continue;
    }

    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    result.push(trimmed);

    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

/**
 * Lọc ngách phụ hợp lệ, loại phần tử trùng ngách chính và khử trùng lặp
 * trước khi cắt tối đa 2 phần tử để không mất nhãn hợp lệ đứng sau.
 */
function sanitizeSecondarySubCategories(
  input: unknown,
  primarySubCategory: SubCategorySlug | "uncategorized",
): SubCategorySlug[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<SubCategorySlug>();
  const result: SubCategorySlug[] = [];

  for (const item of input) {
    if (typeof item !== "string") {
      continue;
    }

    const trimmed = item.trim();
    if (!isValidSubCategory(trimmed)) {
      continue;
    }

    if (trimmed === primarySubCategory || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    result.push(trimmed);

    if (result.length >= 2) {
      break;
    }
  }

  return result;
}

export const AiClassificationSchema = z
  .object({
    summary_vi: z.string().trim().min(10).max(500),
    category: z
      .unknown()
      .optional()
      .transform((val): CategorySlug | "other" => {
        const trimmed = typeof val === "string" ? val.trim() : "";
        return isValidCategory(trimmed) ? trimmed : "other";
      }),
    sub_category: z
      .unknown()
      .optional()
      .transform((val): SubCategorySlug | "uncategorized" => {
        const trimmed = typeof val === "string" ? val.trim() : "";
        return isValidSubCategory(trimmed) ? trimmed : "uncategorized";
      }),
    secondary_sub_categories: z.unknown().optional(),
    use_cases: z
      .array(z.unknown())
      .transform((items) => sanitizeStringArray(items, 4))
      .refine((items) => items.length >= 1, {
        message: "use_cases phải có ít nhất 1 cụm từ hợp lệ",
      }),
    replaces: z
      .unknown()
      .optional()
      .transform((val) => sanitizeStringArray(val, 3)),
    usability: z.preprocess(
      (val) => (typeof val === "string" ? val.trim() : val),
      z.enum(VALID_USABILITY_LEVELS).catch("dev-required"),
    ),
  })
  .transform(({ secondary_sub_categories, ...rest }) => ({
    summary_vi: rest.summary_vi,
    category: rest.category,
    sub_category: rest.sub_category,
    secondary_sub_categories: sanitizeSecondarySubCategories(
      secondary_sub_categories,
      rest.sub_category,
    ),
    use_cases: rest.use_cases,
    replaces: rest.replaces,
    usability: rest.usability,
  }));

export type AiClassification = z.infer<typeof AiClassificationSchema>;

export const ToolIdParamSchema = z.coerce.number().int().positive();

export type ToolIdParam = z.infer<typeof ToolIdParamSchema>;

export const ToolPatchSchema = z
  .object({
    isPinned: z.boolean().optional(),
    userNotes: z.string().max(2000).nullable().optional(),
    subCategory: z.enum(VALID_SUB_CATEGORIES).optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.isPinned !== undefined ||
      data.userNotes !== undefined ||
      data.subCategory !== undefined,
    {
      message:
        "Payload phải có ít nhất một trường hợp lệ (isPinned, userNotes, subCategory)",
    },
  );

export type ToolPatchInput = z.infer<typeof ToolPatchSchema>;
