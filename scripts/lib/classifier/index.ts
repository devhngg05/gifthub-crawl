import { sanitizeErrorMessage } from "@/lib/sanitize-error";
import { type AiClassification } from "@/lib/validator";
import {
  AllProvidersExhaustedError,
  areAllProvidersUnavailable,
  DEFAULT_MAX_COOLDOWN_WAIT_MS,
} from "./cooldown";
import {
  executeWithProviderFallback,
  type ClassifyRepoOptions,
} from "./fallback";
import {
  buildBatchSystemPrompt,
  buildBatchUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  type ClassifyRepoInput,
} from "./prompts";
import { getActiveProviders } from "./providers";
import {
  requestBatchClassificationFromProvider,
  requestClassificationFromProvider,
} from "./transport";

export * from "./providers";
export * from "./cooldown";
export * from "./prompts";
export * from "./transport";
export * from "./fallback";

export const DEFAULT_TIMEOUT_MS = 25_000;
export const DEFAULT_BATCH_TIMEOUT_MS = 45_000;

export interface ClassifyRepoResult {
  classification: AiClassification;
  provider: string;
}

export type BatchClassifyOutcome =
  | { fullName: string; ok: true; result: ClassifyRepoResult }
  | {
      fullName: string;
      ok: false;
      error: string;
      allProvidersLongTermCooldown?: boolean;
    };

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
      const isLongTerm =
        error instanceof AllProvidersExhaustedError &&
        error.allLongTermCooldown;
      return [
        {
          fullName: single.fullName,
          ok: false,
          error: sanitizeErrorMessage(error),
          ...(isLongTerm ? { allProvidersLongTermCooldown: true } : {}),
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
  const nowFn = options.now ?? (() => Date.now());
  const maxCooldownWaitMs =
    options.maxCooldownWaitMs ?? DEFAULT_MAX_COOLDOWN_WAIT_MS;
  const systemPrompt = buildBatchSystemPrompt();
  const userPrompt = buildBatchUserPrompt(inputs);
  const batchLabel = `batch(${inputs.length} repos)`;

  const resolvedMap = new Map<string, ClassifyRepoResult>();
  let batchLongTermExhausted = false;

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
    if (
      batchError instanceof AllProvidersExhaustedError &&
      batchError.allLongTermCooldown
    ) {
      batchLongTermExhausted = true;
    }
    console.warn(
      `[classifier] Batch fallback to per-repo classification (${inputs.length} repos): ${sanitizeErrorMessage(batchError)}`,
    );
  }

  const outcomes: BatchClassifyOutcome[] = [];
  let allProvidersExhaustedReason: string | null = null;

  for (const input of inputs) {
    const matched = resolvedMap.get(input.fullName);
    if (matched) {
      outcomes.push({ fullName: input.fullName, ok: true, result: matched });
      continue;
    }

    if (allProvidersExhaustedReason) {
      outcomes.push({
        fullName: input.fullName,
        ok: false,
        error: allProvidersExhaustedReason,
        allProvidersLongTermCooldown: true,
      });
      continue;
    }

    if (
      batchLongTermExhausted ||
      areAllProvidersUnavailable(
        activeProviders,
        options.providerCooldowns,
        nowFn(),
        maxCooldownWaitMs,
      )
    ) {
      allProvidersExhaustedReason = `All AI providers are cooling down beyond ${Math.ceil(maxCooldownWaitMs / 1000)}s limit; skipping remaining per-repo fallbacks`;
      console.warn(
        `[classifier] ${allProvidersExhaustedReason} (${batchLabel})`,
      );
      outcomes.push({
        fullName: input.fullName,
        ok: false,
        error: allProvidersExhaustedReason,
        allProvidersLongTermCooldown: true,
      });
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
      const sanitized = sanitizeErrorMessage(error);
      const isLongTerm =
        error instanceof AllProvidersExhaustedError &&
        error.allLongTermCooldown;
      if (isLongTerm) {
        allProvidersExhaustedReason = sanitized;
      }
      outcomes.push({
        fullName: input.fullName,
        ok: false,
        error: sanitized,
        ...(isLongTerm ? { allProvidersLongTermCooldown: true } : {}),
      });
    }
  }

  return outcomes;
}
