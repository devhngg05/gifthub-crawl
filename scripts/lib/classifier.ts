import { z } from "zod";
import { TAXONOMY_PROMPT_GUIDE } from "@/config/taxonomy";
import { AiClassificationSchema, type AiClassification } from "@/lib/validator";

export interface AiProviderConfig {
  name: string;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  supportsJsonObjectResponseFormat: boolean;
}

export interface ActiveAiProvider extends AiProviderConfig {
  apiKey: string;
}

export interface ClassifyRepoInput {
  name: string;
  fullName: string;
  description: string;
  language: string | null;
  topics: string[];
  readmeText: string;
}

export interface ClassifyRepoResult {
  classification: AiClassification;
  provider: string;
}

export interface ClassifyRepoOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_TOKENS = 4096;
export const MAX_ERROR_BODY_LENGTH = 200;

export const PROVIDERS: readonly AiProviderConfig[] = [
  {
    name: "Groq-120B",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    apiKeyEnv: "GROQ_API_KEY",
    supportsJsonObjectResponseFormat: true,
  },
  {
    name: "Groq-Qwen-27B",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "qwen/qwen3.8-27b",
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
    name: "OpenRouter-Free",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemma-4-31b-it:free",
    apiKeyEnv: "OPENROUTER_API_KEY",
    supportsJsonObjectResponseFormat: false,
  },
] as const;

const ChatCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
});

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

/** Dựng system prompt chuẩn OpenAI-compatible nhúng TAXONOMY_PROMPT_GUIDE từ nguồn chân lý duy nhất. */
export function buildSystemPrompt(): string {
  return [
    "Bạn là chuyên gia phân loại công cụ mã nguồn mở trên GitHub cho hệ thống github-tool-radar.",
    "Hãy phân tích thông tin repository được cung cấp và CHỈ trả về duy nhất một đối tượng JSON hợp lệ (không thêm giải thích ngoài JSON).",
    "",
    "BẮT BUỘC sử dụng đúng slug trong bộ Taxonomy gốc dưới đây (tuyệt đối không bịa slug ngoài danh sách):",
    TAXONOMY_PROMPT_GUIDE,
    "",
    "Cấu trúc JSON trả về:",
    "{",
    '  "summary_vi": "Tóm tắt công dụng cốt lõi bằng tiếng Việt tự nhiên (10-500 ký tự). Bất kể README gốc viết bằng ngôn ngữ nào, luôn viết tóm tắt tiếng Việt và giữ nguyên tên công nghệ, giao thức hoặc thuật ngữ chuyên ngành tiếng Anh (ví dụ: REST API, Docker, LLM, CLI, ORM).",',
    '  "category": "1 slug nhóm lớn hợp lệ trong Taxonomy ở trên",',
    '  "sub_category": "1 slug ngách chuyên sâu hợp lệ thuộc nhóm lớn ở trên",',
    '  "secondary_sub_categories": ["Tối đa 2 slug ngách phụ hợp lệ khác với sub_category (mảng rỗng [] nếu không có)"],',
    '  "use_cases": ["1 đến 4 cụm từ ngắn bằng tiếng Việt dạng động từ + đối tượng, ví dụ: Kiểm thử REST API"],',
    '  "replaces": ["0 đến 3 tên phần mềm thương mại có thể thay thế, ví dụ: Postman"],',
    '  "usability": "app-ready | cli-tool | dev-required"',
    "}",
    "",
    "Quy ước usability:",
    '- "app-ready": Có ứng dụng Desktop/Web UI hoặc Docker Compose dùng ngay cho người không chuyên sâu code.',
    '- "cli-tool": Công cụ dòng lệnh (CLI) cài qua npm/pip/brew/binary dùng trực tiếp trong terminal.',
    '- "dev-required": Thư viện/SDK/framework cần lập trình viên tích hợp vào mã nguồn.',
  ].join("\n");
}

/** Dựng user prompt từ metadata và nội dung README đã làm sạch của repository. */
export function buildUserPrompt(input: ClassifyRepoInput): string {
  const topicsText =
    input.topics.length > 0 ? input.topics.join(", ") : "(không có)";
  const languageText = input.language ?? "Không rõ";
  const readmeSection =
    input.readmeText.trim().length > 0
      ? input.readmeText.trim()
      : "(Không có nội dung README)";

  return [
    `Repository: ${input.fullName} (${input.name})`,
    `Description: ${input.description}`,
    `Primary Language: ${languageText}`,
    `Topics: ${topicsText}`,
    "",
    "README (đã làm sạch, tối đa 2.500 ký tự):",
    readmeSection,
  ].join("\n");
}

/** Gỡ bỏ khối suy luận `<think>...</think>` của các model reasoning trước khi bóc JSON. */
export function stripThinkTags(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/** Gỡ bỏ markdown code fence (```json ... ``` hoặc ``` ... ```) trước khi JSON.parse. */
export function stripMarkdownCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && fencedMatch[1] !== undefined) {
    return fencedMatch[1].trim();
  }
  return trimmed;
}

/**
 * Làm sạch đầu ra của model reasoning: gỡ `<think>...</think>`, gỡ markdown code fence,
 * và trích xuất JSON object (`{ ... }`) nếu model kèm văn bản giải thích xung quanh.
 */
export function extractJsonFromModelOutput(raw: string): string {
  const withoutThink = stripThinkTags(raw);
  const withoutFences = stripMarkdownCodeFence(withoutThink);
  const firstBrace = withoutFences.indexOf("{");
  const lastBrace = withoutFences.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return withoutFences.slice(firstBrace, lastBrace + 1).trim();
  }

  return withoutFences;
}

function buildProviderHeaders(provider: ActiveAiProvider): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };

  if (provider.name === "OpenRouter-Free") {
    headers["HTTP-Referer"] = "https://github.com/github-tool-radar";
    headers["X-Title"] = "github-tool-radar";
  }

  return headers;
}

/** Nối endpoint `/chat/completions` bằng chuỗi chuẩn để giữ nguyên subpath (`/openai/v1`, `/api/v1`). */
export function buildChatCompletionsEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/** Rút gọn và làm sạch body lỗi HTTP/response trước khi log (tối đa 200 ký tự, không lộ secret). */
export function sanitizeResponseSnippet(
  rawText: string,
  apiKey?: string,
  maxLength = MAX_ERROR_BODY_LENGTH,
): string {
  let sanitized = rawText;

  const trimmedKey = apiKey?.trim();
  if (trimmedKey && trimmedKey.length > 0) {
    sanitized = sanitized.split(trimmedKey).join("[REDACTED_TOKEN]");
  }

  sanitized = sanitized
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/Bearer\s+[^\s"'`]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:gsk|ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_-]+/g,
      "[REDACTED_TOKEN]",
    )
    .replace(/\bgithub_pat_[A-Za-z0-9_]+/g, "[REDACTED_TOKEN]")
    .replace(/\bsk-or-[A-Za-z0-9_-]+/g, "[REDACTED_TOKEN]")
    .replace(/\s+/g, " ")
    .trim();

  if (sanitized.length <= maxLength) {
    return sanitized;
  }

  if (maxLength <= 3) {
    return sanitized.slice(0, maxLength);
  }

  return `${sanitized.slice(0, maxLength - 3)}...`;
}

async function readResponseTextSafely(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function sendChatCompletionRequest(
  provider: ActiveAiProvider,
  endpoint: string,
  systemPrompt: string,
  userPrompt: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  useJsonResponseFormat: boolean,
): Promise<Response> {
  const payload: {
    model: string;
    temperature: number;
    max_tokens: number;
    messages: Array<{ role: "system" | "user"; content: string }>;
    response_format?: { type: "json_object" };
  } = {
    model: provider.model,
    temperature: 0.2,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };

  if (useJsonResponseFormat) {
    payload.response_format = { type: "json_object" };
  }

  return fetchImpl(endpoint, {
    method: "POST",
    headers: buildProviderHeaders(provider),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function requestClassificationFromProvider(
  provider: ActiveAiProvider,
  systemPrompt: string,
  userPrompt: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<AiClassification> {
  const endpoint = buildChatCompletionsEndpoint(provider.baseUrl);
  const useJsonFormat = provider.supportsJsonObjectResponseFormat;

  let response = await sendChatCompletionRequest(
    provider,
    endpoint,
    systemPrompt,
    userPrompt,
    fetchImpl,
    timeoutMs,
    useJsonFormat,
  );

  // Fallback an toàn nếu provider không hỗ trợ `response_format: { type: "json_object" }` và trả HTTP 400
  if (response.status === 400 && useJsonFormat) {
    await readResponseTextSafely(response);
    response = await sendChatCompletionRequest(
      provider,
      endpoint,
      systemPrompt,
      userPrompt,
      fetchImpl,
      timeoutMs,
      false,
    );
  }

  const rawBody = await readResponseTextSafely(response);

  if (!response.ok) {
    const snippet = sanitizeResponseSnippet(rawBody, provider.apiKey);
    throw new Error(
      `HTTP ${response.status} [${endpoint}]${snippet ? ` (${snippet})` : ""}`,
    );
  }

  let envelopeRaw: unknown;
  try {
    envelopeRaw = JSON.parse(rawBody);
  } catch {
    const snippet = sanitizeResponseSnippet(rawBody, provider.apiKey);
    throw new Error(
      `Invalid JSON response envelope [${endpoint}]${snippet ? ` (${snippet})` : ""}`,
    );
  }

  const envelopeParsed = ChatCompletionResponseSchema.safeParse(envelopeRaw);
  if (!envelopeParsed.success) {
    throw new Error("Malformed chat completion envelope");
  }

  const rawContent = envelopeParsed.data.choices[0]?.message.content;
  if (!rawContent || rawContent.trim().length === 0) {
    throw new Error("Empty model response content");
  }

  const cleanJsonText = extractJsonFromModelOutput(rawContent);
  let jsonPayload: unknown;
  try {
    jsonPayload = JSON.parse(cleanJsonText);
  } catch {
    throw new Error("Invalid JSON returned by model");
  }

  const validated = AiClassificationSchema.safeParse(jsonPayload);
  if (!validated.success) {
    const issueFields = validated.error.issues
      .map((issue) => issue.path.join(".") || "root")
      .join(", ");
    throw new Error(`Schema validation failed (${issueFields})`);
  }

  return validated.data;
}

/**
 * Phân loại repository qua chuỗi fallback 4 AI provider chuẩn OpenAI-compatible.
 * Ném Error rõ ràng (không chứa secret) nếu thiếu provider hoặc cả 4 provider đều thất bại.
 */
export async function classifyRepo(
  input: ClassifyRepoInput,
  options: ClassifyRepoOptions = {},
): Promise<ClassifyRepoResult> {
  const activeProviders = getActiveProviders(options.env);
  if (activeProviders.length === 0) {
    throw new Error(
      `No AI providers configured for ${input.fullName}: missing GROQ_API_KEY, OPENROUTER_API_KEY`,
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(input);
  const failures: string[] = [];

  for (const provider of activeProviders) {
    try {
      const classification = await requestClassificationFromProvider(
        provider,
        systemPrompt,
        userPrompt,
        fetchImpl,
        timeoutMs,
      );
      return { classification, provider: provider.name };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Unknown provider error";
      failures.push(`${provider.name}: ${reason}`);
      console.warn(
        `[classifier] Provider ${provider.name} failed for ${input.fullName}: ${reason}`,
      );
    }
  }

  throw new Error(
    `All AI providers failed for ${input.fullName}: ${failures.join("; ")}`,
  );
}
