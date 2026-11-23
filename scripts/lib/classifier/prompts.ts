import { z } from "zod";
import { TAXONOMY_COMPACT_GUIDE } from "@/config/taxonomy";

export interface ClassifyRepoInput {
  name: string;
  fullName: string;
  description: string;
  homepage?: string | null;
  language: string | null;
  topics: string[];
  readmeText: string;
}

export const MAX_SINGLE_README_PROMPT_CHARS = 1_200;
export const MAX_BATCH_README_PROMPT_CHARS = 600;

export const ChatCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
});

export const BatchJsonPayloadSchema = z.object({
  results: z.array(z.record(z.string(), z.unknown())).min(1),
});

const SHARED_CLASSIFICATION_RULES = [
  "Chỉ dùng slug hợp lệ trong Taxonomy:",
  TAXONOMY_COMPACT_GUIDE,
  "Luật:",
  "- CẤM gán bừa `ai-coding-agent` (chỉ dùng cho trợ lý code/IDE). Chat WebUI -> `ai-chat-ui`; local LLM/gateway -> `local-llm-gateway`; MCP/agent -> `ai-workflow-mcp`; RAG/OCR -> `rag-ocr-extract`; ảnh/video/TTS/STT -> `ai-voice-vision`.",
  "- `security-vault` CHỈ cho quản lý mật khẩu/secrets; quét lỗ hổng/WAF/ẩn danh dùng nhóm `security-privacy`.",
  "- `category` khớp nhóm cha của `sub_category`; `secondary_sub_categories` 0-2 slug khác `sub_category`; tránh `uncategorized`.",
  "- `usability`: `app-ready` (Desktop/Web UI/Docker dùng ngay), `cli-tool` (terminal CLI), `dev-required` (SDK/thư viện/framework).",
].join("\n");

/** Dựng system prompt rút gọn tối đa token nhưng giữ đủ luật phân loại & JSON schema. */
export function buildSystemPrompt(): string {
  return [
    "Phân loại repo GitHub cho Gifthub. Chỉ trả 1 JSON object hợp lệ (không giải thích).",
    SHARED_CLASSIFICATION_RULES,
    'JSON: {"summary_vi":"tóm tắt tiếng Việt 10-500 ký tự, giữ thuật ngữ kỹ thuật tiếng Anh","category":"slug","sub_category":"slug","secondary_sub_categories":[],"use_cases":["1-4 cụm động từ+đối tượng tiếng Việt"],"replaces":["0-3 phần mềm thay thế"],"usability":"app-ready|cli-tool|dev-required"}',
  ].join("\n");
}

/** Dựng system prompt rút gọn cho chế độ phân loại hàng loạt nhiều repository. */
export function buildBatchSystemPrompt(): string {
  return [
    'Phân loại danh sách repo GitHub cho Gifthub. Chỉ trả 1 JSON object {"results":[...]} khớp từng `full_name`.',
    SHARED_CLASSIFICATION_RULES,
    'Item: {"full_name":"owner/repo","summary_vi":"tóm tắt tiếng Việt 10-500 ký tự, giữ thuật ngữ tiếng Anh","category":"slug","sub_category":"slug","secondary_sub_categories":[],"use_cases":["1-4 cụm tiếng Việt"],"replaces":["0-3 phần mềm thay thế"],"usability":"app-ready|cli-tool|dev-required"}',
  ].join("\n");
}

function formatRepoContextBlock(
  input: ClassifyRepoInput,
  maxReadmeChars: number,
): string[] {
  const topicsText =
    input.topics.length > 0 ? input.topics.join(", ") : "(none)";
  const languageText = input.language ?? "unknown";
  const homepage = input.homepage?.trim() ?? "";
  const trimmedReadme = input.readmeText.trim();
  const readmeSection =
    trimmedReadme.length > 0
      ? trimmedReadme.slice(0, maxReadmeChars)
      : "(no README)";

  const lines = [
    `Repo: ${input.fullName} (${input.name})`,
    `Desc: ${input.description}`,
  ];

  if (homepage.length > 0) {
    lines.push(`Homepage: ${homepage}`);
  }

  lines.push(
    `Lang: ${languageText} | Topics: ${topicsText}`,
    `README: ${readmeSection}`,
  );

  return lines;
}

/** Dựng user prompt gọn (tối đa 1.200 ký tự README) từ metadata và README sạch của repository. */
export function buildUserPrompt(input: ClassifyRepoInput): string {
  return formatRepoContextBlock(input, MAX_SINGLE_README_PROMPT_CHARS).join(
    "\n",
  );
}

/** Dựng user prompt gộp nhiều repository (tối đa 600 ký tự README/repo) cho `classifyRepoBatch()`. */
export function buildBatchUserPrompt(
  inputs: readonly ClassifyRepoInput[],
): string {
  return inputs
    .map((input, idx) =>
      [
        `[${idx + 1}]`,
        ...formatRepoContextBlock(input, MAX_BATCH_README_PROMPT_CHARS),
      ].join("\n"),
    )
    .join("\n\n");
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
