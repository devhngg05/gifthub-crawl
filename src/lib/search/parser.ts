import type { SubCategorySlug } from "@/config/taxonomy";
import {
  normalizeSearchText,
  SINGLE_SOFT_STOPWORDS,
  stripMultiwordSoftStopwords,
} from "./normalize";
import { TRIGGER_LOOKUP, type SynonymConceptEntry } from "./synonyms";

export interface ParsedSearchQuery {
  rawQuery: string;
  normalizedQuery: string;
  coreTokens: string[];
  conceptGroups: string[][];
  matchedSubCategories: SubCategorySlug[];
  isReplaceIntent: boolean;
  replaceTarget: string | null;
}

const REPLACE_INTENT_PATTERN =
  /^(?:thay the cho|thay the|giong nhu|giong|tuong tu nhu|tuong tu|alternative to|alternative for|alt to|alt for|replaces|replace)\s+(.+)$/;

function mergeMatchingEntries(
  entries: readonly SynonymConceptEntry[],
  fallbackToken: string,
  subCategorySet: Set<SubCategorySlug>,
): string[] {
  const terms = new Set<string>([fallbackToken]);
  for (const entry of entries) {
    for (const syn of entry.synonyms) {
      terms.add(syn);
    }
    for (const sub of entry.subCategories ?? []) {
      subCategorySet.add(sub);
    }
  }
  return Array.from(terms);
}

/**
 * Phân tích câu truy vấn tự nhiên thành từ khóa lõi, các Concept Groups đồng nghĩa Việt–Anh,
 * danh sách ngách gợi ý và ý định `"thay thế <X>"`.
 */
export function parseSearchQuery(rawQuery: string): ParsedSearchQuery {
  const normalizedQuery = normalizeSearchText(rawQuery);
  if (!normalizedQuery) {
    return {
      rawQuery,
      normalizedQuery: "",
      coreTokens: [],
      conceptGroups: [],
      matchedSubCategories: [],
      isReplaceIntent: false,
      replaceTarget: null,
    };
  }

  let isReplaceIntent = false;
  let replaceTarget: string | null = null;
  let workingText = normalizedQuery;

  const replaceMatch = normalizedQuery.match(REPLACE_INTENT_PATTERN);
  if (replaceMatch && replaceMatch[1]) {
    const remainder = replaceMatch[1].trim();
    if (remainder.length > 0) {
      isReplaceIntent = true;
      replaceTarget = remainder;
      workingText = remainder;
    }
  }

  const afterMultiStopwords = stripMultiwordSoftStopwords(workingText);
  const candidateTokens = afterMultiStopwords.split(" ").filter(Boolean);
  const filteredTokens = candidateTokens.filter(
    (token) => !SINGLE_SOFT_STOPWORDS.has(token),
  );
  const coreTokens =
    filteredTokens.length > 0 ? filteredTokens : candidateTokens;

  const conceptGroups: string[][] = [];
  const subCategorySet = new Set<SubCategorySlug>();

  let idx = 0;
  while (idx < coreTokens.length) {
    let matchedSpan = 0;
    let matchedEntries: readonly SynonymConceptEntry[] | undefined;
    let matchedPhrase = coreTokens[idx];

    for (const span of [4, 3, 2, 1]) {
      if (idx + span <= coreTokens.length) {
        const phrase = coreTokens.slice(idx, idx + span).join(" ");
        const entries = TRIGGER_LOOKUP.get(phrase);
        if (entries && entries.length > 0) {
          matchedSpan = span;
          matchedEntries = entries;
          matchedPhrase = phrase;
          break;
        }
      }
    }

    if (matchedEntries && matchedSpan > 0) {
      conceptGroups.push(
        mergeMatchingEntries(matchedEntries, matchedPhrase, subCategorySet),
      );
      idx += matchedSpan;
    } else {
      conceptGroups.push([coreTokens[idx]]);
      idx += 1;
    }
  }

  return {
    rawQuery,
    normalizedQuery,
    coreTokens,
    conceptGroups,
    matchedSubCategories: Array.from(subCategorySet),
    isReplaceIntent,
    replaceTarget,
  };
}
