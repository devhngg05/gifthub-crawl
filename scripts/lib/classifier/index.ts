import { sanitizeErrorMessage } from "@/lib/sanitize-error";
import { AiClassificationSchema, type AiClassification } from "@/lib/validator";
import {
  COOLDOWN_WAIT_BUFFER_MS,
  DEFAULT_MAX_COOLDOWN_WAIT_MS,
  MAX_COOLDOWN_WAIT_ROUNDS,
  parseRateLimitRetryAfterMs,
  ProviderRateLimitError,
  ProviderServerError,
  isDailyQuotaErrorBody,
  recordProviderFailureCooldown,
  resetProviderFailureCounters,
} from "./cooldown";
import {
  BatchJsonPayloadSchema,
  buildBatchSystemPrompt,
  buildBatchUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  ChatCompletionResponseSchema,
  extractJsonFromModelOutput,
  type ClassifyRepoInput,
} from "./prompts";
import {
  buildChatCompletionsEndpoint,
  buildProviderHeaders,
  getActiveProviders,
  resolveProviderMaxTokens,
  sanitizeResponseSnippet,
  type ActiveAiProvider,
} from "./providers";

export * from "./providers";
export * from "./cooldown";
export * from "./prompts";

export const DEFAULT_TIMEOUT_MS = 25_000;
export const DEFAULT_BATCH_TIMEOUT_MS = 45_000;

export interface ClassifyRepoResult {
  classification: AiClassification;
  provider: string;
}

export type BatchClassifyOutcome =
  | { fullName: string; ok: true; result: ClassifyRepoResult }
  | { fullName: string; ok: false; error: string };

export interface ClassifyRepoOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  providerCooldowns?: Map<string, number>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxCooldownWaitMs?: number;
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

async function requestProviderJsonPayload(
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
      isBatch,
    );
  }

  const rawBody = await readResponseTextSafely(response);

  if (!response.ok) {
    const snippet = sanitizeResponseSnippet(rawBody, provider.apiKey);
    const errorMessage = `HTTP ${response.status} [${endpoint}]${snippet ? ` (${snippet})` : ""}`;
    if (response.status === 429) {
      throw new ProviderRateLimitError(
        errorMessage,
        parseRateLimitRetryAfterMs(response.headers, rawBody, nowMs),
        isDailyQuotaErrorBody(rawBody),
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

async function requestClassificationFromProvider(
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

async function requestBatchClassificationFromProvider(
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

async function executeWithProviderFallback<T>(
  label: string,
  activeProviders: readonly ActiveAiProvider[],
  options: ClassifyRepoOptions,
  defaultTimeoutMs: number,
  attemptFn: (
    provider: ActiveAiProvider,
    timeoutMs: number,
    nowMs: number,
  ) => Promise<T>,
): Promise<{ data: T; provider: string }> {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const cooldownMap = options.providerCooldowns;
  const nowFn = options.now ?? (() => Date.now());
  const maxCooldownWaitMs =
    options.maxCooldownWaitMs ?? DEFAULT_MAX_COOLDOWN_WAIT_MS;
  const sleepImpl =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const failures: string[] = [];
  let justRateLimited = new Set<string>();

  for (const provider of activeProviders) {
    const currentNowMs = nowFn();
    const cooldownUntil = cooldownMap?.get(provider.name);

    if (cooldownUntil !== undefined) {
      if (cooldownUntil > currentNowMs) {
        const remainingSec = Math.ceil((cooldownUntil - currentNowMs) / 1000);
        failures.push(
          `${provider.name}: Cooling down (${remainingSec}s remaining)`,
        );
        continue;
      }
      cooldownMap?.delete(provider.name);
    }

    try {
      const data = await attemptFn(provider, timeoutMs, currentNowMs);
      cooldownMap?.delete(provider.name);
      if (cooldownMap) {
        resetProviderFailureCounters(cooldownMap, provider.name);
      }
      return { data, provider: provider.name };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Unknown provider error";
      if (cooldownMap) {
        recordProviderFailureCooldown(
          provider.name,
          error,
          nowFn(),
          cooldownMap,
        );
      }
      if (error instanceof ProviderRateLimitError) {
        justRateLimited.add(provider.name);
      }
      failures.push(`${provider.name}: ${reason}`);
      console.warn(
        `[classifier] Provider ${provider.name} failed for ${label}: ${reason}`,
      );
    }
  }

  if (cooldownMap) {
    for (
      let waitRound = 1;
      waitRound <= MAX_COOLDOWN_WAIT_ROUNDS;
      waitRound += 1
    ) {
      const checkNowMs = nowFn();
      const coolingEntries: Array<{
        provider: ActiveAiProvider;
        until: number;
        remainingMs: number;
      }> = [];

      for (const provider of activeProviders) {
        const until = cooldownMap.get(provider.name);
        if (until !== undefined && until > checkNowMs) {
          coolingEntries.push({
            provider,
            until,
            remainingMs: until - checkNowMs,
          });
        }
      }

      if (coolingEntries.length === 0) {
        break;
      }

      // Ưu tiên chờ các provider đã cooldown từ trước thay vì quay lại ngay provider vừa dính 429 ở vòng hiện tại
      const preferredPool = coolingEntries.filter(
        (entry) =>
          !justRateLimited.has(entry.provider.name) &&
          entry.remainingMs <= maxCooldownWaitMs,
      );
      const fallbackPool = coolingEntries.filter(
        (entry) => entry.remainingMs <= maxCooldownWaitMs,
      );
      const targetPool =
        preferredPool.length > 0 ? preferredPool : fallbackPool;

      if (targetPool.length === 0) {
        break;
      }

      const minRemainingMs = Math.min(
        ...targetPool.map((entry) => entry.remainingMs),
      );
      const minCooldownUntil = checkNowMs + minRemainingMs;
      const waitMs = minRemainingMs + COOLDOWN_WAIT_BUFFER_MS;
      const waitSec = Math.max(1, Math.ceil(waitMs / 1000));

      console.warn(
        `[classifier] Tất cả provider đang cooldown, chờ ${waitSec}s (vòng ${waitRound}/${MAX_COOLDOWN_WAIT_ROUNDS})... (${label})`,
      );
      await sleepImpl(waitMs);

      const effectiveNowMs = Math.max(
        nowFn(),
        minCooldownUntil + COOLDOWN_WAIT_BUFFER_MS,
      );
      const recoveredProviders = targetPool
        .filter((entry) => entry.until <= effectiveNowMs)
        .map((entry) => entry.provider);

      const nextJustRateLimited = new Set<string>();

      for (const provider of recoveredProviders) {
        cooldownMap.delete(provider.name);
        try {
          const data = await attemptFn(provider, timeoutMs, effectiveNowMs);
          resetProviderFailureCounters(cooldownMap, provider.name);
          return { data, provider: provider.name };
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : "Unknown provider error";
          recordProviderFailureCooldown(
            provider.name,
            error,
            effectiveNowMs,
            cooldownMap,
          );
          if (error instanceof ProviderRateLimitError) {
            nextJustRateLimited.add(provider.name);
          }
          failures.push(`${provider.name} (retry ${waitRound}): ${reason}`);
          console.warn(
            `[classifier] Provider ${provider.name} retry ${waitRound} failed for ${label}: ${reason}`,
          );
        }
      }

      justRateLimited = nextJustRateLimited;
    }
  }

  throw new Error(
    `All AI providers failed for ${label}: ${failures.join("; ")}`,
  );
}

/**
 * Phân loại repository qua chuỗi fallback 10 AI provider chuẩn OpenAI-compatible
 * (`Gemini-3.5-Flash-Lite` → `Gemini-3.1-Flash-Lite` → `Groq-120B` → `Groq-20B-Fast` → `Groq-Qwen-27B` → `Gemini-3.5-Flash` → `Gemini-3.6-Flash` → `Gemini-3.8-Flash` → `OpenRouter-Free` → `OpenRouter-Free-Backup`).
 */
export async function classifyRepo(
  input: ClassifyRepoInput,
  options: ClassifyRepoOptions = {},
): Promise<ClassifyRepoResult> {
  const activeProviders = getActiveProviders(options.env);
  if (activeProviders.length === 0) {
    throw new Error(
      `No AI providers configured for ${input.fullName}: missing GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY`,
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(input);

  const { data, provider } = await executeWithProviderFallback(
    input.fullName,
    activeProviders,
    options,
    DEFAULT_TIMEOUT_MS,
    (activeProvider, timeoutMs, nowMs) =>
      requestClassificationFromProvider(
        activeProvider,
        systemPrompt,
        userPrompt,
        fetchImpl,
        timeoutMs,
        nowMs,
      ),
  );

  return { classification: data, provider };
}

/**
 * Phân loại theo lô nhiều repository cùng lúc (`DEFAULT_BATCH_TIMEOUT_MS = 45s`) kèm `providerCooldowns`.
 * Nếu một số repo trong lô thiếu/lệch schema, tự động fallback phân loại lẻ cho phần thiếu để cô lập lỗi từng repo.
 */
export async function classifyRepoBatch(
  inputs: readonly ClassifyRepoInput[],
  options: ClassifyRepoOptions = {},
): Promise<BatchClassifyOutcome[]> {
  if (inputs.length === 0) {
    return [];
  }

  if (inputs.length === 1) {
    const single = inputs[0];
    try {
      const result = await classifyRepo(single, options);
      return [{ fullName: single.fullName, ok: true, result }];
    } catch (error) {
      return [
        {
          fullName: single.fullName,
          ok: false,
          error: sanitizeErrorMessage(error),
        },
      ];
    }
  }

  const activeProviders = getActiveProviders(options.env);
  if (activeProviders.length === 0) {
    const missingMsg = `No AI providers configured for batch (${inputs.map((i) => i.fullName).join(", ")}): missing GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY`;
    return inputs.map((input) => ({
      fullName: input.fullName,
      ok: false,
      error: missingMsg,
    }));
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const systemPrompt = buildBatchSystemPrompt();
  const userPrompt = buildBatchUserPrompt(inputs);
  const batchLabel = `batch(${inputs.length} repos)`;

  const resolvedMap = new Map<string, ClassifyRepoResult>();

  try {
    const { data: batchMap, provider } = await executeWithProviderFallback(
      batchLabel,
      activeProviders,
      options,
      DEFAULT_BATCH_TIMEOUT_MS,
      (activeProvider, timeoutMs, nowMs) =>
        requestBatchClassificationFromProvider(
          activeProvider,
          systemPrompt,
          userPrompt,
          inputs,
          fetchImpl,
          timeoutMs,
          nowMs,
        ),
    );

    for (const [fullName, classification] of batchMap.entries()) {
      resolvedMap.set(fullName, { classification, provider });
    }
  } catch (batchError) {
    console.warn(
      `[classifier] Batch fallback to per-repo classification (${inputs.length} repos): ${sanitizeErrorMessage(batchError)}`,
    );
  }

  const outcomes: BatchClassifyOutcome[] = [];
  for (const input of inputs) {
    const matched = resolvedMap.get(input.fullName);
    if (matched) {
      outcomes.push({ fullName: input.fullName, ok: true, result: matched });
      continue;
    }

    try {
      const fallbackResult = await classifyRepo(input, options);
      outcomes.push({
        fullName: input.fullName,
        ok: true,
        result: fallbackResult,
      });
    } catch (error) {
      outcomes.push({
        fullName: input.fullName,
        ok: false,
        error: sanitizeErrorMessage(error),
      });
    }
  }

  return outcomes;
}
