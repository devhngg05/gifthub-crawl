import {
  CATEGORY_MAP,
  isValidCategory,
  isValidSubCategory,
  POSITIVE_CATEGORY_KEYWORDS,
  POSITIVE_SUB_CATEGORY_KEYWORDS,
  SUB_CATEGORY_MAP,
} from "@/config/taxonomy";
import { normalizeSearchText } from "./normalize";

export interface BuildToolSearchTextInput {
  name: string;
  fullName: string;
  language?: string | null;
  summaryVi: string;
  category: string;
  subCategory: string;
  secondarySubCategories?: readonly string[];
  useCases?: readonly string[];
  replaces?: readonly string[];
  userNotes?: string | null;
  topics?: readonly string[];
}

/**
 * Tổng hợp văn bản tìm kiếm chuẩn hóa cho 1 công cụ.
 * Chỉ dùng tên tiếng Việt, slug và từ khóa tích cực từ `taxonomy.ts` (không ghép mệnh đề phủ định).
 */
export function buildToolSearchText(input: BuildToolSearchTextInput): string {
  const parts: string[] = [
    input.name,
    input.fullName,
    input.language ?? "",
    input.summaryVi,
    ...(input.useCases ?? []),
    ...(input.replaces ?? []),
    input.userNotes ?? "",
    ...(input.topics ?? []),
  ];

  if (isValidCategory(input.category)) {
    parts.push(
      input.category,
      CATEGORY_MAP[input.category].label,
      POSITIVE_CATEGORY_KEYWORDS[input.category],
    );
  } else if (input.category) {
    parts.push(input.category);
  }

  const subSlugs = [
    input.subCategory,
    ...(input.secondarySubCategories ?? []),
  ];
  const seenSubs = new Set<string>();
  for (const subSlug of subSlugs) {
    if (!subSlug || seenSubs.has(subSlug)) {
      continue;
    }
    seenSubs.add(subSlug);

    if (isValidSubCategory(subSlug)) {
      parts.push(
        subSlug,
        SUB_CATEGORY_MAP[subSlug].label,
        POSITIVE_SUB_CATEGORY_KEYWORDS[subSlug],
      );
    } else {
      parts.push(subSlug);
    }
  }

  return normalizeSearchText(parts.filter(Boolean).join(" "));
}
