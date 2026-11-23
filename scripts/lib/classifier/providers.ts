import { sanitizeResponseSnippet as sanitizeSnippetShared } from "@/lib/sanitize-error";

export interface AiProviderConfig {
  name: string;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  supportsJsonObjectResponseFormat: boolean;
  maxTokens?: number;
  batchMaxTokens?: number;
}

export interface ActiveAiProvider extends AiProviderConfig {
  apiKey: string;
}

export const DEFAULT_MAX_TOKENS = 4096;
export const GEMINI_SINGLE_MAX_TOKENS = 2048;
export const GEMINI_BATCH_MAX_TOKENS = 4096;
export const GROQ_QWEN_MAX_TOKENS = 750;
export const GROQ_QWEN_BATCH_MAX_TOKENS = 4096;
export const MAX_ERROR_BODY_LENGTH = 200;

export const PROVIDERS: readonly AiProviderConfig[] = [
  {
    name: "Gemini-3.5-Flash-Lite",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.5-flash-lite",
    apiKeyEnv: "GEMINI_API_KEY",
    supportsJsonObjectResponseFormat: true,
    maxTokens: GEMINI_SINGLE_MAX_TOKENS,
    batchMaxTokens: GEMINI_BATCH_MAX_TOKENS,
  },
  {
    name: "Gemini-3.1-Flash-Lite",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.1-flash-lite",
    apiKeyEnv: "GEMINI_API_KEY",
    supportsJsonObjectResponseFormat: true,
    maxTokens: GEMINI_SINGLE_MAX_TOKENS,
    batchMaxTokens: GEMINI_BATCH_MAX_TOKENS,
  },
  {
    name: "Groq-120B",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    apiKeyEnv: "GROQ_API_KEY",
    supportsJsonObjectResponseFormat: true,
  },
  {
    name: "Groq-20B-Fast",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-20b",
    apiKeyEnv: "GROQ_API_KEY",
    supportsJsonObjectResponseFormat: true,
  },
  {
    name: "Groq-Qwen-27B",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "qwen/qwen3.8-27b",
    apiKeyEnv: "GROQ_API_KEY",
    supportsJsonObjectResponseFormat: true,
    maxTokens: GROQ_QWEN_MAX_TOKENS,
    batchMaxTokens: GROQ_QWEN_BATCH_MAX_TOKENS,
  },
  {
    name: "Gemini-3.5-Flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.5-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    supportsJsonObjectResponseFormat: true,
    maxTokens: GEMINI_SINGLE_MAX_TOKENS,
    batchMaxTokens: GEMINI_BATCH_MAX_TOKENS,
  },
  {
    name: "Gemini-3.6-Flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.6-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    supportsJsonObjectResponseFormat: true,
    maxTokens: GEMINI_SINGLE_MAX_TOKENS,
    batchMaxTokens: GEMINI_BATCH_MAX_TOKENS,
  },
  {
    name: "Gemini-3.8-Flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.8-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    supportsJsonObjectResponseFormat: true,
    maxTokens: GEMINI_SINGLE_MAX_TOKENS,
    batchMaxTokens: GEMINI_BATCH_MAX_TOKENS,
  },
  {
    name: "OpenRouter-Free",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemma-4-31b-it:free",
    apiKeyEnv: "OPENROUTER_API_KEY",
    supportsJsonObjectResponseFormat: false,
  },
  {
    name: "OpenRouter-Free-Backup",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemma-4-26b-a4b-it:free",
    apiKeyEnv: "OPENROUTER_API_KEY",
    supportsJsonObjectResponseFormat: false,
  },
] as const;

/** Lọc động danh sách provider có API key tại runtime theo đúng thứ tự ưu tiên. */
export function getActiveProviders(
  env: Record<string, string | undefined> = process.env,
): ActiveAiProvider[] {
  const active: ActiveAiProvider[] = [];

  for (const provider of PROVIDERS) {
    const rawKey = env[provider.apiKeyEnv];
    const apiKey = typeof rawKey === "string" ? rawKey.trim() : "";
    if (apiKey.length > 0) {
      active.push({ ...provider, apiKey });
    }
  }

  return active;
}

export function buildProviderHeaders(
  provider: ActiveAiProvider,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };

  if (provider.apiKeyEnv === "OPENROUTER_API_KEY") {
    headers["HTTP-Referer"] = "https://github.com/github-tool-radar";
    headers["X-Title"] = "github-tool-radar";
  }

  return headers;
}

/** Nối endpoint `/chat/completions` bằng chuỗi chuẩn để giữ nguyên subpath (`/openai/v1`, `/api/v1`). */
export function buildChatCompletionsEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

export function resolveProviderMaxTokens(
  provider: ActiveAiProvider,
  isBatch: boolean,
): number {
  if (isBatch) {
    return (
      provider.batchMaxTokens ?? provider.maxTokens ?? DEFAULT_MAX_TOKENS
    );
  }
  return provider.maxTokens ?? DEFAULT_MAX_TOKENS;
}

/** Rút gọn và làm sạch body lỗi HTTP/response trước khi log (tối đa 200 ký tự, không lộ secret). */
export function sanitizeResponseSnippet(
  rawText: string,
  apiKey?: string,
  maxLength = MAX_ERROR_BODY_LENGTH,
): string {
  return sanitizeSnippetShared(rawText, apiKey, maxLength);
}
