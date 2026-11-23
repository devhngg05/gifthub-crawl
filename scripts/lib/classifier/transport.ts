import { AiClassificationSchema, type AiClassification } from "@/lib/validator";
import {
  classifyDailyQuotaErrorBody,
  parseRateLimitRetryAfterMs,
  ProviderRateLimitError,
  ProviderServerError,
} from "./cooldown";
import {
  BatchJsonPayloadSchema,
  ChatCompletionResponseSchema,
  extractJsonFromModelOutput,
  type ClassifyRepoInput,
} from "./prompts";
import {
  buildChatCompletionsEndpoint,
  buildProviderHeaders,
  resolveProviderMaxTokens,
  sanitizeResponseSnippet,
  type ActiveAiProvider,
} from "./providers";

const RESPONSE_FORMAT_UNSUPPORTED_PATTERN =
  /response_format|json_object|json mode|structured output/i;

/** Kiểm tra body lỗi HTTP 400 có liên quan đến việc không hỗ trợ `response_format`/`json_object` không. */
export function isResponseFormatUnsupportedError(rawBody: string): boolean {
  return RESPONSE_FORMAT_UNSUPPORTED_PATTERN.test(rawBody);
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
  isBatch: boolean,
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
    max_tokens: resolveProviderMaxTokens(provider, isBatch),
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

export async function requestProviderJsonPayload(
  provider: ActiveAiProvider,
  systemPrompt: string,
  userPrompt: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  nowMs: number,
  isBatch: boolean,
): Promise<unknown> {
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
    isBatch,
  );
  let rawBody = await readResponseTextSafely(response);

  // Chỉ thử lại bỏ `response_format` khi HTTP 400 thực sự liên quan đến `response_format` / `json_object`
  if (
    response.status === 400 &&
    useJsonFormat &&
    isResponseFormatUnsupportedError(rawBody)
  ) {
    response = await sendChatCompletionRequest(
      provider,
      endpoint,
      systemPrompt,
      userPrompt,
      fetchImpl,
      timeoutMs,
      false,
      isBatch,
    );
    rawBody = await readResponseTextSafely(response);
  }

  if (!response.ok) {
    const snippet = sanitizeResponseSnippet(rawBody, provider.apiKey);
    const errorMessage = `HTTP ${response.status} [${endpoint}]${snippet ? ` (${snippet})` : ""}`;
    if (response.status === 429) {
      const quotaSeverity = classifyDailyQuotaErrorBody(rawBody);
      const isHardDaily = quotaSeverity === "hard";
      const isDaily = quotaSeverity !== "none";
      throw new ProviderRateLimitError(
        errorMessage,
        parseRateLimitRetryAfterMs(response.headers, rawBody, nowMs, {
          isHardDailyQuota: isHardDaily,
        }),
        isDaily,
        isHardDaily,
      );
    }
    if (response.status >= 500 && response.status <= 599) {
      throw new ProviderServerError(errorMessage, response.status);
    }
    throw new Error(errorMessage);
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

  const firstChoice = envelopeParsed.data.choices[0];
  const rawContent = firstChoice?.message.content;
  if (!rawContent || rawContent.trim().length === 0) {
    throw new Error("Empty model response content");
  }

  const cleanJsonText = extractJsonFromModelOutput(rawContent);
  try {
    return JSON.parse(cleanJsonText);
  } catch {
    if (firstChoice?.finish_reason === "length") {
      throw new Error(
        "Truncated JSON returned by model (finish_reason: length)",
      );
    }
    throw new Error("Invalid JSON returned by model");
  }
}

export async function requestClassificationFromProvider(
  provider: ActiveAiProvider,
  systemPrompt: string,
  userPrompt: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  nowMs: number,
): Promise<AiClassification> {
  const jsonPayload = await requestProviderJsonPayload(
    provider,
    systemPrompt,
    userPrompt,
    fetchImpl,
    timeoutMs,
    nowMs,
    false,
  );

  const validated = AiClassificationSchema.safeParse(jsonPayload);
  if (!validated.success) {
    const issueFields = validated.error.issues
      .map((issue) => issue.path.join(".") || "root")
      .join(", ");
    throw new Error(`Schema validation failed (${issueFields})`);
  }

  return validated.data;
}

export async function requestBatchClassificationFromProvider(
  provider: ActiveAiProvider,
  systemPrompt: string,
  userPrompt: string,
  inputs: readonly ClassifyRepoInput[],
  fetchImpl: typeof fetch,
  timeoutMs: number,
  nowMs: number,
): Promise<Map<string, AiClassification>> {
  const jsonPayload = await requestProviderJsonPayload(
    provider,
    systemPrompt,
    userPrompt,
    fetchImpl,
    timeoutMs,
    nowMs,
    true,
  );

  const parsedBatch = BatchJsonPayloadSchema.safeParse(jsonPayload);
  if (!parsedBatch.success) {
    throw new Error("Batch schema validation failed (results)");
  }

  const expectedByLowerName = new Map<string, string>();
  for (const input of inputs) {
    expectedByLowerName.set(input.fullName.toLowerCase(), input.fullName);
  }

  const matched = new Map<string, AiClassification>();
  for (const item of parsedBatch.data.results) {
    const rawFullName = item.full_name;
    if (typeof rawFullName !== "string") {
      continue;
    }
    const canonicalName = expectedByLowerName.get(
      rawFullName.trim().toLowerCase(),
    );
    if (!canonicalName || matched.has(canonicalName)) {
      continue;
    }

    const validatedItem = AiClassificationSchema.safeParse(item);
    if (validatedItem.success) {
      matched.set(canonicalName, validatedItem.data);
    }
  }

  if (matched.size === 0) {
    throw new Error("Batch schema validation failed (no valid item matched)");
  }

  return matched;
}
