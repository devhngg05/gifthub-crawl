import type { AiClassification } from "@/lib/validator";

export interface AiProviderConfig {
  name: string;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
}

export interface ClassifyRepoInput {
  name: string;
  fullName: string;
  description: string;
  language: string | null;
  topics: string[];
  readmeText: string;
}

export async function classifyRepo(
  input: ClassifyRepoInput,
): Promise<AiClassification | null> {
  void input;
  return null;
}
