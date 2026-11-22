export type UsabilityLevel = "app-ready" | "cli-tool" | "dev-required";

export interface AiClassification {
  summary_vi: string;
  category: string;
  sub_category: string;
  secondary_sub_categories: string[];
  use_cases: string[];
  replaces: string[];
  usability: UsabilityLevel;
}

export interface ToolPatchInput {
  isPinned?: boolean;
  userNotes?: string | null;
  subCategory?: string;
}

export type ToolIdParam = number;
