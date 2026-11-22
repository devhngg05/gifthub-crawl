export interface SubCategoryDefinition {
  readonly slug: string;
  readonly label: string;
  readonly hint: string;
}

export interface CategoryDefinition {
  readonly slug: string;
  readonly label: string;
  readonly subCategories: readonly SubCategoryDefinition[];
}

export const TAXONOMY: readonly CategoryDefinition[] = [];

export const VALID_CATEGORIES: readonly string[] = [];

export const VALID_SUB_CATEGORIES: readonly string[] = [];

export const SUB_CATEGORY_TO_CATEGORY: Readonly<Record<string, string>> = {};
