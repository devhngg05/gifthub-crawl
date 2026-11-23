import { afterEach, describe, expect, it, vi } from "vitest";
import { TAXONOMY_COMPACT_GUIDE } from "@/config/taxonomy";
import {
  buildBatchSystemPrompt,
  buildBatchUserPrompt,
  buildChatCompletionsEndpoint,
  buildSystemPrompt,
  buildUserPrompt,
  classifyRepo,
  classifyRepoBatch,
  COOLDOWN_WAIT_BUFFER_MS,
  DAILY_QUOTA_COOLDOWN_MS,
  DEFAULT_BATCH_TIMEOUT_MS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_RATE_LIMIT_COOLDOWN_MS,
  DEFAULT_TIMEOUT_MS,
  extractJsonFromModelOutput,
  GEMINI_BATCH_MAX_TOKENS,
  GEMINI_SINGLE_MAX_TOKENS,
  getActiveProviders,
  GROQ_QWEN_MAX_TOKENS,
  isDailyQuotaErrorBody,
  isTimeoutOrAbortError,
  MAX_BATCH_README_PROMPT_CHARS,
  MAX_COOLDOWN_WAIT_ROUNDS,
  MAX_ERROR_BODY_LENGTH,
  MAX_RATE_LIMIT_COOLDOWN_MS,
  MAX_SINGLE_README_PROMPT_CHARS,
  MIN_RATE_LIMIT_COOLDOWN_MS,
  parseRateLimitRetryAfterMs,
  PROVIDERS,
  sanitizeResponseSnippet,
  SERVER_ERROR_COOLDOWN_MS,
  SERVER_ERROR_ESCALATED_COOLDOWN_MS,
  stripMarkdownCodeFence,
  stripThinkTags,
  TIMEOUT_COOLDOWN_MS,
  type ClassifyRepoInput,
} from "../classifier";

const SAMPLE_INPUT: ClassifyRepoInput = {
  name: "bruno",
  fullName: "usebruno/bruno",
  description: "Opensource IDE For Exploring and Testing APIs",
  language: "TypeScript",
  topics: ["api-client", "rest", "graphql"],
  readmeText:
    "Bruno is a fast, Git-friendly opensource API client aimed at revolutionizing the status quo represented by Postman.",
};

const VALID_AI_PAYLOAD = {
  summary_vi:
    "Công cụ kiểm thử REST API và GraphQL mã nguồn mở lưu trữ collection trực tiếp dưới dạng file, thay thế Postman.",
  category: "api-integration",
  sub_category: "api-client-testing",
  secondary_sub_categories: ["api-mock-docs"],
  use_cases: ["Kiểm thử REST API", "Quản lý collection bằng Git"],
  replaces: ["Postman", "Insomnia"],
  usability: "app-ready",
};

const FULL_MOCK_ENV: Record<string, string> = {
  GEMINI_API_KEY: "AIzaSyMockGeminiSecretKeyValue123456",
  GROQ_API_KEY: "gsk_mock_groq_secret_value",
  OPENROUTER_API_KEY: "sk-or-mock_openrouter_secret_value",
};

function makeChatCompletionResponse(
  content: string,
  status = 200,
  extra?: { finish_reason?: string; extra_content?: unknown },
): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          ...(extra?.finish_reason !== undefined
            ? { finish_reason: extra.finish_reason }
            : {}),
          ...(extra?.extra_content !== undefined
            ? { extra_content: extra.extra_content }
            : {}),
          message: { content },
        },
      ],
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifier — provider priority & env filtering", () => {
  it("filters out providers missing API keys at runtime while preserving exact speed-optimized 10-tier order", () => {
    expect(PROVIDERS.map((p) => p.name)).toEqual([
      "Gemini-3.5-Flash-Lite",
      "Gemini-3.1-Flash-Lite",
      "Groq-120B",
      "Groq-20B-Fast",
      "Groq-Qwen-27B",
      "Gemini-3.5-Flash",
      "Gemini-3.6-Flash",
      "Gemini-3.8-Flash",
      "OpenRouter-Free",
      "OpenRouter-Free-Backup",
    ]);

    expect(PROVIDERS.map((p) => p.model)).toEqual([
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3.8-27b",
      "gemini-3.5-flash",
      "gemini-3.6-flash",
      "gemini-3.8-flash",
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
    ]);

    const onlyGemini = getActiveProviders({
      GEMINI_API_KEY: "AIzaSyOnlyGeminiKey1234567890",
    });
    expect(onlyGemini.map((p) => p.name)).toEqual([
      "Gemini-3.5-Flash-Lite",
      "Gemini-3.1-Flash-Lite",
      "Gemini-3.5-Flash",
      "Gemini-3.6-Flash",
      "Gemini-3.8-Flash",
    ]);
    for (const geminiTier of onlyGemini) {
      expect(geminiTier.maxTokens).toBe(GEMINI_SINGLE_MAX_TOKENS);
      expect(geminiTier.batchMaxTokens).toBe(GEMINI_BATCH_MAX_TOKENS);
    }

    const blankGemini = getActiveProviders({
      GEMINI_API_KEY: "   ",
      GROQ_API_KEY: "gsk_test",
    });
    expect(blankGemini.map((p) => p.name)).toEqual([
      "Groq-120B",
      "Groq-20B-Fast",
      "Groq-Qwen-27B",
    ]);
    expect(blankGemini[2]?.maxTokens).toBe(GROQ_QWEN_MAX_TOKENS);

    const onlyOpenRouter = getActiveProviders({
      OPENROUTER_API_KEY: "sk-or-test",
    });
    expect(onlyOpenRouter.map((p) => p.name)).toEqual([
      "OpenRouter-Free",
      "OpenRouter-Free-Backup",
    ]);

    const blankGroq = getActiveProviders({
      GROQ_API_KEY: "   ",
      OPENROUTER_API_KEY: "sk-or-test",
    });
    expect(blankGroq.map((p) => p.name)).toEqual([
      "OpenRouter-Free",
      "OpenRouter-Free-Backup",
    ]);

    const onlyGroq = getActiveProviders({
      GROQ_API_KEY: "gsk_test",
    });
    expect(onlyGroq.map((p) => p.name)).toEqual([
      "Groq-120B",
      "Groq-20B-Fast",
      "Groq-Qwen-27B",
    ]);
  });
});

describe("classifier — reasoning tag & JSON cleanup", () => {
  it("strips ```json fences, plain ``` fences, and preserves raw JSON", () => {
    expect(
      stripMarkdownCodeFence('```json\n{"summary_vi": "test"}\n```'),
    ).toBe('{"summary_vi": "test"}');
    expect(stripMarkdownCodeFence('```\n{"summary_vi": "test"}\n```')).toBe(
      '{"summary_vi": "test"}',
    );
    expect(stripMarkdownCodeFence('  {"summary_vi": "test"}  ')).toBe(
      '{"summary_vi": "test"}',
    );
  });

  it("strips <think>...</think> blocks and surrounding prose before JSON.parse", () => {
    expect(stripThinkTags("<think>suy luận nháp</think>\n{}")).toBe("{}");

    const reasoningOutput = [
      "<THINK>",
      "Phân tích repo Bruno: {nháp bên trong think không được làm hỏng}",
      "</THINK>",
      "Dưới đây là kết quả phân loại:",
      "```json",
      JSON.stringify(VALID_AI_PAYLOAD),
      "```",
      "Chúc bạn thành công!",
    ].join("\n");

    const extracted = extractJsonFromModelOutput(reasoningOutput);
    expect(JSON.parse(extracted)).toEqual(VALID_AI_PAYLOAD);
  });
});

describe("classifier — OpenAI-compatible payload & multi-provider fallback", () => {
  it("prioritizes Gemini-3.5-Flash-Lite with max_tokens >= 2048, TAXONOMY_PROMPT_GUIDE, and thought_signature tolerance", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      makeChatCompletionResponse(
        `<think>Phân tích kỹ trước khi trả JSON</think>\n\`\`\`json\n${JSON.stringify(VALID_AI_PAYLOAD)}\n\`\`\``,
        200,
        {
          finish_reason: "stop",
          extra_content: { google: { thought_signature: "sig-gemini-mock" } },
        },
      ),
    );

    const result = await classifyRepo(SAMPLE_INPUT, {
      env: FULL_MOCK_ENV,
      fetchImpl: fetchMock,
    });

    expect(result.provider).toBe("Gemini-3.5-Flash-Lite");
    expect(result.classification.category).toBe("api-integration");
    expect(result.classification.sub_category).toBe("api-client-testing");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: `Bearer ${FULL_MOCK_ENV.GEMINI_API_KEY}`,
    });

    const body = JSON.parse(String(init?.body)) as {
      model: string;
      temperature: number;
      max_tokens: number;
      response_format?: { type: string };
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("gemini-3.5-flash-lite");
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(GEMINI_SINGLE_MAX_TOKENS);
    expect(body.max_tokens).toBe(2048);
    expect(DEFAULT_MAX_TOKENS).toBe(4096);
    expect(GEMINI_BATCH_MAX_TOKENS).toBe(4096);
    expect(GROQ_QWEN_MAX_TOKENS).toBe(750);
    expect(DEFAULT_TIMEOUT_MS).toBe(25_000);
    expect(DEFAULT_BATCH_TIMEOUT_MS).toBe(45_000);
    expect(TIMEOUT_COOLDOWN_MS).toBe(180_000);
    expect(DAILY_QUOTA_COOLDOWN_MS).toBe(1_800_000);
    expect(SERVER_ERROR_COOLDOWN_MS).toBe(120_000);
    expect(SERVER_ERROR_ESCALATED_COOLDOWN_MS).toBe(300_000);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[0]?.content).toContain(TAXONOMY_COMPACT_GUIDE);
    expect(body.messages[0]?.content).toContain("tiếng Việt");
  });

  it("falls back immediately and places timed-out provider into a 180s cooldown across subsequent calls", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      isTimeoutOrAbortError(
        new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      ),
    ).toBe(true);
    expect(
      isTimeoutOrAbortError(new DOMException("Aborted", "AbortError")),
    ).toBe(true);
    expect(isTimeoutOrAbortError(new Error("ECONNRESET"))).toBe(false);

    let fakeNowMs = 5_000_000;
    const providerCooldowns = new Map<string, number>();

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(
        new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      )
      .mockResolvedValueOnce(
        makeChatCompletionResponse(JSON.stringify(VALID_AI_PAYLOAD)),
      )
      .mockResolvedValueOnce(
        makeChatCompletionResponse(JSON.stringify(VALID_AI_PAYLOAD)),
      );

    const first = await classifyRepo(SAMPLE_INPUT, {
      env: { GEMINI_API_KEY: FULL_MOCK_ENV.GEMINI_API_KEY },
      fetchImpl: fetchMock,
      providerCooldowns,
      now: () => fakeNowMs,
    });

    expect(first.provider).toBe("Gemini-3.1-Flash-Lite");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(providerCooldowns.get("Gemini-3.5-Flash-Lite")).toBe(
      fakeNowMs + TIMEOUT_COOLDOWN_MS,
    );

    // 60s later (< 180s): Gemini-3.5-Flash-Lite is skipped immediately without calling fetch
    fakeNowMs += 60_000;
    const second = await classifyRepo(SAMPLE_INPUT, {
      env: { GEMINI_API_KEY: FULL_MOCK_ENV.GEMINI_API_KEY },
      fetchImpl: fetchMock,
      providerCooldowns,
      now: () => fakeNowMs,
    });

    expect(second.provider).toBe("Gemini-3.1-Flash-Lite");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const thirdCallModel = (
      JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as { model: string }
    ).model;
    expect(thirdCallModel).toBe("gemini-3.1-flash-lite");
  });

  it("falls back cleanly when a Gemini reasoning tier returns truncated JSON with finish_reason: length", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        makeChatCompletionResponse(
          '{"summary_vi":"Đoạn JSON bị cắt cụt giữa chừng',
          200,
          {
            finish_reason: "length",
            extra_content: { google: { thought_signature: "sig-truncated" } },
          },
        ),
      )
      .mockResolvedValueOnce(
        makeChatCompletionResponse(JSON.stringify(VALID_AI_PAYLOAD), 200, {
          finish_reason: "stop",
        }),
      );

    const result = await classifyRepo(SAMPLE_INPUT, {
      env: { GEMINI_API_KEY: FULL_MOCK_ENV.GEMINI_API_KEY },
      fetchImpl: fetchMock,
    });

    expect(result.provider).toBe("Gemini-3.1-Flash-Lite");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as { model: string; max_tokens: number };
    const secondBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as { model: string; max_tokens: number };
    expect(firstBody.model).toBe("gemini-3.5-flash-lite");
    expect(firstBody.max_tokens).toBe(2048);
    expect(secondBody.model).toBe("gemini-3.1-flash-lite");
    expect(secondBody.max_tokens).toBe(2048);

    expect(warnSpy.mock.calls[0]?.[0]).toContain(
      "Truncated JSON returned by model (finish_reason: length)",
    );
  });

  it("retries without response_format if a Groq layer returns HTTP 400, and omits response_format on OpenRouter-Free", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{"error":"response_format not supported"}', {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(
        makeChatCompletionResponse(JSON.stringify(VALID_AI_PAYLOAD)),
      );

    const groqRetryResult = await classifyRepo(SAMPLE_INPUT, {
      env: { GROQ_API_KEY: "gsk_mock_groq_secret_value" },
      fetchImpl: fetchMock,
    });

    expect(groqRetryResult.provider).toBe("Groq-120B");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      response_format?: { type: string };
    };
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      response_format?: { type: string };
    };
    expect(firstBody.response_format).toEqual({ type: "json_object" });
    expect(retryBody.response_format).toBeUndefined();

    // Kiểm chứng OpenRouter-Free không gửi response_format ngay từ đầu
    const openRouterFetchMock = vi.fn<typeof fetch>(async () =>
      makeChatCompletionResponse(
        `<think>reasoning</think>\`\`\`json\n${JSON.stringify(VALID_AI_PAYLOAD)}\n\`\`\``,
      ),
    );
    const openRouterResult = await classifyRepo(SAMPLE_INPUT, {
      env: { OPENROUTER_API_KEY: "sk-or-mock_openrouter_secret_value" },
      fetchImpl: openRouterFetchMock,
    });

    expect(openRouterResult.provider).toBe("OpenRouter-Free");
    const openRouterBody = JSON.parse(
      String(openRouterFetchMock.mock.calls[0]?.[1]?.body),
    ) as {
      model: string;
      max_tokens: number;
      response_format?: { type: string };
    };
    expect(openRouterBody.model).toBe("google/gemma-4-31b-it:free");
    expect(openRouterBody.max_tokens).toBeGreaterThanOrEqual(2048);
    expect(openRouterBody.response_format).toBeUndefined();
  });

  it("falls back sequentially across all 10 live providers with exact URLs, models, max_tokens, and OpenRouter headers", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      buildChatCompletionsEndpoint(
        "https://generativelanguage.googleapis.com/v1beta/openai/",
      ),
    ).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(
      buildChatCompletionsEndpoint("https://api.groq.com/openai/v1/"),
    ).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(
      buildChatCompletionsEndpoint("https://openrouter.ai/api/v1/"),
    ).toBe("https://openrouter.ai/api/v1/chat/completions");

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Gemini 3.5 Lite unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("Gemini 3.1 Lite busy", { status: 429 }))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(
        makeChatCompletionResponse(
          JSON.stringify({
            ...VALID_AI_PAYLOAD,
            summary_vi: "Quá ngắn",
            use_cases: [],
          }),
        ),
      )
      .mockResolvedValueOnce(makeChatCompletionResponse("{ broken json"))
      .mockResolvedValueOnce(new Response("Gemini 3.5 rate limit", { status: 429 }))
      .mockResolvedValueOnce(new Response("Gemini 3.6 unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        makeChatCompletionResponse('{"summary_vi":"truncated', 200, {
          finish_reason: "length",
        }),
      )
      .mockResolvedValueOnce(new Response("OpenRouter 31B busy", { status: 429 }))
      .mockResolvedValueOnce(
        makeChatCompletionResponse(
          `<think>gemma 4 26b thinking</think>\n${JSON.stringify(VALID_AI_PAYLOAD)}`,
        ),
      );

    const result = await classifyRepo(SAMPLE_INPUT, {
      env: FULL_MOCK_ENV,
      fetchImpl: fetchMock,
    });

    expect(result.provider).toBe("OpenRouter-Free-Backup");
    expect(result.classification.replaces).toEqual(["Postman", "Insomnia"]);
    expect(fetchMock).toHaveBeenCalledTimes(10);

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      "https://api.groq.com/openai/v1/chat/completions",
      "https://api.groq.com/openai/v1/chat/completions",
      "https://api.groq.com/openai/v1/chat/completions",
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      "https://openrouter.ai/api/v1/chat/completions",
      "https://openrouter.ai/api/v1/chat/completions",
    ]);

    expect(
      fetchMock.mock.calls.map(
        (call) =>
          (JSON.parse(String(call[1]?.body)) as { model: string }).model,
      ),
    ).toEqual([
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3.8-27b",
      "gemini-3.5-flash",
      "gemini-3.6-flash",
      "gemini-3.8-flash",
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
    ]);

    // Verify Groq-Qwen-27B uses max_tokens: 750 and Gemini tiers use 2048 for single calls
    const maxTokensList = fetchMock.mock.calls.map(
      (call) =>
        (JSON.parse(String(call[1]?.body)) as { max_tokens: number }).max_tokens,
    );
    expect(maxTokensList).toEqual([
      2048, 2048, 4096, 4096, 750, 2048, 2048, 2048, 4096, 4096,
    ]);

    const backupInit = fetchMock.mock.calls[9]?.[1];
    expect(backupInit?.headers).toMatchObject({
      "HTTP-Referer": "https://github.com/github-tool-radar",
      "X-Title": "github-tool-radar",
    });
    const backupBody = JSON.parse(String(backupInit?.body)) as {
      response_format?: unknown;
    };
    expect(backupBody.response_format).toBeUndefined();
  });

  it("throws descriptive error with sanitized snippets (<= 200 chars) without leaking secrets when all 10 providers fail", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const longBodyWithGeminiSecret = `{"error":{"message":"Invalid key ${FULL_MOCK_ENV.GEMINI_API_KEY} ${"y".repeat(300)}"}}`;
    const longBodyWithGroqSecret = `{"error":{"message":"Model not found for Bearer ${FULL_MOCK_ENV.GROQ_API_KEY} ${"x".repeat(300)}"}}`;
    expect(
      sanitizeResponseSnippet(
        longBodyWithGeminiSecret,
        FULL_MOCK_ENV.GEMINI_API_KEY,
      ).length,
    ).toBeLessThanOrEqual(MAX_ERROR_BODY_LENGTH);
    expect(
      sanitizeResponseSnippet(
        longBodyWithGroqSecret,
        FULL_MOCK_ENV.GROQ_API_KEY,
      ).length,
    ).toBeLessThanOrEqual(MAX_ERROR_BODY_LENGTH);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("ECONNABORTED"))
      .mockResolvedValueOnce(new Response("Gemini 3.1 error", { status: 502 }))
      .mockResolvedValueOnce(
        new Response(longBodyWithGroqSecret, { status: 404 }),
      )
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockResolvedValueOnce(new Response("Bad Gateway", { status: 502 }))
      .mockResolvedValueOnce(new Response("Quota exceeded", { status: 429 }))
      .mockResolvedValueOnce(new Response("Gemini 3.6 error", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(longBodyWithGeminiSecret, { status: 403 }),
      )
      .mockResolvedValueOnce(makeChatCompletionResponse("not-json-at-all"))
      .mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }));

    let caught: unknown;
    try {
      await classifyRepo(SAMPLE_INPUT, {
        env: FULL_MOCK_ENV,
        fetchImpl: fetchMock,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toMatch(/All AI providers failed for usebruno\/bruno/);
    expect(message).toContain("Gemini-3.5-Flash-Lite: ECONNABORTED");
    expect(message).toContain("Gemini-3.1-Flash-Lite: HTTP 502");
    expect(message).toContain(
      "Groq-120B: HTTP 404 [https://api.groq.com/openai/v1/chat/completions] (",
    );
    expect(message).toContain("...");
    expect(message).toContain("Groq-20B-Fast: ETIMEDOUT");
    expect(message).toContain(
      "Groq-Qwen-27B: HTTP 502 [https://api.groq.com/openai/v1/chat/completions] (Bad Gateway)",
    );
    expect(message).toContain(
      "Gemini-3.5-Flash: HTTP 429 [https://generativelanguage.googleapis.com/v1beta/openai/chat/completions] (Quota exceeded)",
    );
    expect(message).toContain("Gemini-3.6-Flash: HTTP 503");
    expect(message).toContain(
      "Gemini-3.8-Flash: HTTP 403 [https://generativelanguage.googleapis.com/v1beta/openai/chat/completions] (",
    );
    expect(message).toContain("OpenRouter-Free: Invalid JSON returned by model");
    expect(message).toContain(
      "OpenRouter-Free-Backup: HTTP 503 [https://openrouter.ai/api/v1/chat/completions] (Service Unavailable)",
    );

    for (const secret of Object.values(FULL_MOCK_ENV)) {
      expect(message).not.toContain(secret);
      for (const warnArgs of warnSpy.mock.calls) {
        expect(warnArgs.join(" ")).not.toContain(secret);
      }
    }
  });

  it("throws immediately without calling fetch when no AI providers are configured", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      classifyRepo(SAMPLE_INPUT, { env: {}, fetchImpl: fetchMock }),
    ).rejects.toThrow(/No AI providers configured for usebruno\/bruno/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses Retry-After headers and Groq TPM wait hints accurately", () => {
    expect(
      parseRateLimitRetryAfterMs(new Headers({ "retry-after": "15" }), ""),
    ).toBe(15_000);

    const baseNow = Date.UTC(2026, 10, 23, 8, 0, 0);
    const futureHeader = new Date(baseNow + 25_000).toUTCString();
    expect(
      parseRateLimitRetryAfterMs(
        new Headers({ "retry-after": futureHeader }),
        "",
        baseNow,
      ),
    ).toBe(25_000);

    expect(
      parseRateLimitRetryAfterMs(
        new Headers(),
        '{"error":{"message":"Rate limit reached for model on TPM: Limit 8000. Please try again in 14.5s."}}',
      ),
    ).toBe(14_500);

    expect(
      parseRateLimitRetryAfterMs(
        new Headers(),
        "Please try again in 1m5s.",
      ),
    ).toBe(65_000);

    expect(
      parseRateLimitRetryAfterMs(
        new Headers(),
        "Please try again in 200ms.",
      ),
    ).toBe(MIN_RATE_LIMIT_COOLDOWN_MS);

    expect(
      parseRateLimitRetryAfterMs(new Headers({ "retry-after": "600" }), ""),
    ).toBe(MAX_RATE_LIMIT_COOLDOWN_MS);

    expect(parseRateLimitRetryAfterMs(new Headers(), "rate limited")).toBe(
      DEFAULT_RATE_LIMIT_COOLDOWN_MS,
    );
  });

  it("skips cooling-down 429 providers across batch calls and sleeps to recover when all providers cool down", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    let fakeNowMs = 1_000_000;
    const providerCooldowns = new Map<string, number>();
    const sleepCalls: number[] = [];
    const sleepMock = vi.fn(async (ms: number) => {
      sleepCalls.push(ms);
      fakeNowMs += ms;
    });

    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      if (body.model === "openai/gpt-oss-120b") {
        // Fails with 429 initially (12s cooldown), succeeds once recovered at fakeNowMs >= 1_012_000
        if (fakeNowMs < 1_012_000) {
          return new Response(
            '{"error":{"message":"Rate limit reached on TPM 8000. Please try again in 12s."}}',
            { status: 429 },
          );
        }
        return makeChatCompletionResponse(JSON.stringify(VALID_AI_PAYLOAD));
      }
      if (body.model === "qwen/qwen3.8-27b") {
        // Succeeds on repo 1, hits 429 (30s) on repo 2
        if (
          fetchMock.mock.calls.filter((c) =>
            String(c[1]?.body).includes("qwen/qwen3.8-27b"),
          ).length === 1
        ) {
          return makeChatCompletionResponse(JSON.stringify(VALID_AI_PAYLOAD));
        }
        return new Response("TPM exceeded", {
          status: 429,
          headers: { "retry-after": "30" },
        });
      }
      if (body.model === "openai/gpt-oss-20b") {
        return new Response("TPM exceeded", {
          status: 429,
          headers: { "retry-after": "40" },
        });
      }
      return new Response("OpenRouter free rate limit", {
        status: 429,
        headers: { "retry-after": "50" },
      });
    });

    const groqAndOpenRouterEnv = {
      GROQ_API_KEY: FULL_MOCK_ENV.GROQ_API_KEY,
      OPENROUTER_API_KEY: FULL_MOCK_ENV.OPENROUTER_API_KEY,
    };

    // Repo 1: Groq-120B hits 429 (12s) -> Groq-20B-Fast hits 429 (40s) -> falls back to Groq-Qwen-27B (Gemini skipped because GEMINI_API_KEY is unset)
    const first = await classifyRepo(SAMPLE_INPUT, {
      env: groqAndOpenRouterEnv,
      fetchImpl: fetchMock,
      providerCooldowns,
      sleep: sleepMock,
      now: () => fakeNowMs,
    });
    expect(first.provider).toBe("Groq-Qwen-27B");
    expect(providerCooldowns.get("Groq-120B")).toBe(1_012_000);
    expect(providerCooldowns.get("Groq-20B-Fast")).toBe(1_040_000);

    // Advance 2s (< 12s): Repo 2 skips Groq-120B & Groq-20B-Fast without calling them; Qwen & OpenRouter hit 429 -> waits remaining 10s -> retries recovered Groq-120B
    fakeNowMs += 2_000;
    const callsBeforeRepo2 = fetchMock.mock.calls.length;
    const second = await classifyRepo(SAMPLE_INPUT, {
      env: groqAndOpenRouterEnv,
      fetchImpl: fetchMock,
      providerCooldowns,
      sleep: sleepMock,
      now: () => fakeNowMs,
    });

    expect(second.provider).toBe("Groq-120B");
    expect(sleepCalls).toEqual([10_000 + COOLDOWN_WAIT_BUFFER_MS]);
    expect(
      warnSpy.mock.calls.some((args) =>
        String(args[0]).includes(
          "[classifier] Tất cả provider đang cooldown, chờ 11s (vòng 1/2)...",
        ),
      ),
    ).toBe(true);

    const repo2Models = fetchMock.mock.calls
      .slice(callsBeforeRepo2)
      .map(
        (c) => (JSON.parse(String(c[1]?.body)) as { model: string }).model,
      );
    // Notice Groq-120B and Groq-20B-Fast were NOT called during cooldown, only Groq-120B retried after sleep(10_000)
    expect(repo2Models).toEqual([
      "qwen/qwen3.8-27b",
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
      "openai/gpt-oss-120b",
    ]);
  });

  it("escalates HTTP 429 daily-quota cooldown to 30m after 2 consecutive failures and resets count on success", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      isDailyQuotaErrorBody("Quota exceeded for metric: GenerateRequestsPerDay"),
    ).toBe(true);
    expect(
      isDailyQuotaErrorBody("You exceeded your current quota, please check billing"),
    ).toBe(true);
    expect(isDailyQuotaErrorBody("TPM limit reached, try again in 5s")).toBe(false);

    let fakeNowMs = 10_000_000;
    const providerCooldowns = new Map<string, number>();

    let liteAttempt = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      if (body.model === "gemini-3.5-flash-lite") {
        liteAttempt += 1;
        if (liteAttempt === 1 || liteAttempt === 2 || liteAttempt === 4) {
          return new Response(
            '{"error":{"message":"You exceeded your current quota (PerDay limit)"}}',
            { status: 429 },
          );
        }
        return makeChatCompletionResponse(JSON.stringify(VALID_AI_PAYLOAD));
      }
      return makeChatCompletionResponse(JSON.stringify(VALID_AI_PAYLOAD));
    });

    const geminiEnv = { GEMINI_API_KEY: FULL_MOCK_ENV.GEMINI_API_KEY };

    // 1st daily-quota 429 -> 60_000 ms cooldown, falls back to Gemini-3.1-Flash-Lite
    const res1 = await classifyRepo(SAMPLE_INPUT, {
      env: geminiEnv,
      fetchImpl: fetchMock,
      providerCooldowns,
      now: () => fakeNowMs,
    });
    expect(res1.provider).toBe("Gemini-3.1-Flash-Lite");
    expect(providerCooldowns.get("Gemini-3.5-Flash-Lite")).toBe(
      fakeNowMs + DEFAULT_RATE_LIMIT_COOLDOWN_MS,
    );

    // Advance past 60s -> 2nd consecutive daily-quota 429 -> escalates to 1_800_000 ms (30 minutes)
    fakeNowMs += DEFAULT_RATE_LIMIT_COOLDOWN_MS + 1_000;
    const res2 = await classifyRepo(SAMPLE_INPUT, {
      env: geminiEnv,
      fetchImpl: fetchMock,
      providerCooldowns,
      now: () => fakeNowMs,
    });
    expect(res2.provider).toBe("Gemini-3.1-Flash-Lite");
    expect(providerCooldowns.get("Gemini-3.5-Flash-Lite")).toBe(
      fakeNowMs + DAILY_QUOTA_COOLDOWN_MS,
    );

    // 5 minutes later (< 30m) -> skipped immediately without calling fetch for lite
    fakeNowMs += 300_000;
    const res3 = await classifyRepo(SAMPLE_INPUT, {
      env: geminiEnv,
      fetchImpl: fetchMock,
      providerCooldowns,
      now: () => fakeNowMs,
    });
    expect(res3.provider).toBe("Gemini-3.1-Flash-Lite");
    expect(liteAttempt).toBe(2);

    // Advance past 30m -> liteAttempt 3 succeeds -> resets consecutive counter to 0
    fakeNowMs += DAILY_QUOTA_COOLDOWN_MS;
    const res4 = await classifyRepo(SAMPLE_INPUT, {
      env: geminiEnv,
      fetchImpl: fetchMock,
      providerCooldowns,
      now: () => fakeNowMs,
    });
    expect(res4.provider).toBe("Gemini-3.5-Flash-Lite");
    expect(providerCooldowns.has("Gemini-3.5-Flash-Lite")).toBe(false);

    // Next daily-quota 429 (liteAttempt 4) gets 60_000 ms again (counter was reset!)
    const res5 = await classifyRepo(SAMPLE_INPUT, {
      env: geminiEnv,
      fetchImpl: fetchMock,
      providerCooldowns,
      now: () => fakeNowMs,
    });
    expect(res5.provider).toBe("Gemini-3.1-Flash-Lite");
    expect(providerCooldowns.get("Gemini-3.5-Flash-Lite")).toBe(
      fakeNowMs + DEFAULT_RATE_LIMIT_COOLDOWN_MS,
    );
  });

  it("places HTTP 5xx server errors into 120s -> 300s cooldowns and resets consecutive counter on 200 OK", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    let fakeNowMs = 8_000_000;
    const providerCooldowns = new Map<string, number>();

    let liteAttempt = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      if (body.model === "gemini-3.5-flash-lite") {
        liteAttempt += 1;
        if (liteAttempt === 1 || liteAttempt === 2 || liteAttempt === 4) {
          return new Response("Upstream temporarily overloaded", { status: 503 });
        }
        return makeChatCompletionResponse(JSON.stringify(VALID_AI_PAYLOAD));
      }
      return makeChatCompletionResponse(JSON.stringify(VALID_AI_PAYLOAD));
    });

    const geminiEnv = { GEMINI_API_KEY: FULL_MOCK_ENV.GEMINI_API_KEY };

    // 1st 503 -> 120_000 ms cooldown
    const res1 = await classifyRepo(SAMPLE_INPUT, {
      env: geminiEnv,
      fetchImpl: fetchMock,
      providerCooldowns,
      now: () => fakeNowMs,
    });
    expect(res1.provider).toBe("Gemini-3.1-Flash-Lite");
    expect(providerCooldowns.get("Gemini-3.5-Flash-Lite")).toBe(
      fakeNowMs + SERVER_ERROR_COOLDOWN_MS,
    );

    // 60s later (< 120s) -> skipped immediately without calling fetch for 3.5-lite
    fakeNowMs += 60_000;
    const res2 = await classifyRepo(SAMPLE_INPUT, {
      env: geminiEnv,
      fetchImpl: fetchMock,
      providerCooldowns,
      now: () => fakeNowMs,
    });
    expect(res2.provider).toBe("Gemini-3.1-Flash-Lite");
    expect(liteAttempt).toBe(1);

    // Past 120s -> 2nd consecutive 503 -> escalates to 300_000 ms (5m)
    fakeNowMs += 65_000;
    const res3 = await classifyRepo(SAMPLE_INPUT, {
      env: geminiEnv,
      fetchImpl: fetchMock,
      providerCooldowns,
      now: () => fakeNowMs,
    });
    expect(res3.provider).toBe("Gemini-3.1-Flash-Lite");
    expect(liteAttempt).toBe(2);
    expect(providerCooldowns.get("Gemini-3.5-Flash-Lite")).toBe(
      fakeNowMs + SERVER_ERROR_ESCALATED_COOLDOWN_MS,
    );

    // Past 300s -> liteAttempt 3 returns 200 OK -> resets consecutive 5xx counter to 0
    fakeNowMs += SERVER_ERROR_ESCALATED_COOLDOWN_MS + 1_000;
    const res4 = await classifyRepo(SAMPLE_INPUT, {
      env: geminiEnv,
      fetchImpl: fetchMock,
      providerCooldowns,
      now: () => fakeNowMs,
    });
    expect(res4.provider).toBe("Gemini-3.5-Flash-Lite");
    expect(providerCooldowns.has("Gemini-3.5-Flash-Lite")).toBe(false);

    // Next 503 (liteAttempt 4) gets 120_000 ms again (counter was reset!)
    const res5 = await classifyRepo(SAMPLE_INPUT, {
      env: geminiEnv,
      fetchImpl: fetchMock,
      providerCooldowns,
      now: () => fakeNowMs,
    });
    expect(res5.provider).toBe("Gemini-3.1-Flash-Lite");
    expect(providerCooldowns.get("Gemini-3.5-Flash-Lite")).toBe(
      fakeNowMs + SERVER_ERROR_COOLDOWN_MS,
    );
  });
});

describe("classifier — prompt precision & batch classification", () => {
  it("includes homepage context, caps README lengths (1200 single / 600 batch), and enforces strict compact system prompts", () => {
    expect(MAX_SINGLE_README_PROMPT_CHARS).toBe(1200);
    expect(MAX_BATCH_README_PROMPT_CHARS).toBe(600);
    expect(MAX_COOLDOWN_WAIT_ROUNDS).toBe(2);

    const longReadme = "X".repeat(2500);
    const withHomepage = buildUserPrompt({
      ...SAMPLE_INPUT,
      homepage: "https://www.usebruno.com",
      readmeText: longReadme,
    });
    expect(withHomepage).toContain("Homepage: https://www.usebruno.com");
    expect(withHomepage).toContain(`README: ${"X".repeat(1200)}`);
    expect(withHomepage).not.toContain("X".repeat(1201));

    const withoutHomepage = buildUserPrompt({
      ...SAMPLE_INPUT,
      homepage: null,
    });
    expect(withoutHomepage).not.toContain("Homepage:");

    const sysPrompt = buildSystemPrompt();
    expect(sysPrompt).toContain(TAXONOMY_COMPACT_GUIDE);
    expect(sysPrompt).toContain("CẤM gán bừa `ai-coding-agent`");
    expect(sysPrompt).toContain("security-vault");
    expect(sysPrompt).toContain("security-privacy");
    expect(sysPrompt).toContain("app-ready");
    expect(sysPrompt).toContain("cli-tool");
    expect(sysPrompt).toContain("dev-required");

    const batchSysPrompt = buildBatchSystemPrompt();
    expect(batchSysPrompt).toContain('"results"');
    expect(batchSysPrompt).toContain(TAXONOMY_COMPACT_GUIDE);

    const batchUserPrompt = buildBatchUserPrompt([
      {
        ...SAMPLE_INPUT,
        homepage: "https://www.usebruno.com",
        readmeText: longReadme,
      },
      {
        name: "ollama",
        fullName: "ollama/ollama",
        description: "Get up and running with Llama 3 locally",
        language: "Go",
        topics: ["llm"],
        readmeText: "Run local LLMs with ollama run.",
      },
    ]);
    expect(batchUserPrompt).toContain("usebruno/bruno");
    expect(batchUserPrompt).toContain("ollama/ollama");
    expect(batchUserPrompt).toContain(`README: ${"X".repeat(600)}`);
    expect(batchUserPrompt).not.toContain("X".repeat(601));
  });

  it("does not immediately retry a just-429'd last provider, waits minRemainingMs + 1s for recovering tier (up to 2 rounds), and fails fast if all cooldowns > 65s", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    let fakeNowMs = 2_000_000;
    const sleepCalls: number[] = [];
    const sleepMock = vi.fn(async (ms: number) => {
      sleepCalls.push(ms);
      fakeNowMs += ms;
    });

    // Groq-120B was already cooling down with 12s remaining; Groq-20B-Fast has 25s remaining;
    // Groq-Qwen-27B is the ONLY active tier left and returns 429 with a shorter 3s hint.
    // Code MUST NOT immediately wait 3s and retry Groq-Qwen-27B — it must prefer waiting 12s + 1s for Groq-120B.
    const providerCooldowns = new Map<string, number>([
      ["Groq-120B", fakeNowMs + 12_000],
      ["Groq-20B-Fast", fakeNowMs + 25_000],
    ]);

    const fetchMock = vi
      .fn<typeof fetch>()
      // Round 1: Groq-Qwen-27B fails 429 (3s)
      .mockResolvedValueOnce(
        new Response("TPM limit reached, try again in 3s.", { status: 429 }),
      )
      // Wait round 1 (after 13s): Groq-120B still fails 429 (60s)
      .mockResolvedValueOnce(
        new Response("Still cooling", {
          status: 429,
          headers: { "retry-after": "60" },
        }),
      )
      // Wait round 2 (after 12s remaining on Groq-20B-Fast + 1s = 13s): Groq-20B-Fast succeeds!
      .mockResolvedValueOnce(
        makeChatCompletionResponse(JSON.stringify(VALID_AI_PAYLOAD)),
      );

    const result = await classifyRepo(SAMPLE_INPUT, {
      env: { GROQ_API_KEY: FULL_MOCK_ENV.GROQ_API_KEY },
      fetchImpl: fetchMock,
      providerCooldowns,
      sleep: sleepMock,
      now: () => fakeNowMs,
    });

    expect(result.provider).toBe("Groq-20B-Fast");
    expect(sleepCalls).toEqual([
      12_000 + COOLDOWN_WAIT_BUFFER_MS,
      12_000 + COOLDOWN_WAIT_BUFFER_MS,
    ]);
    expect(
      fetchMock.mock.calls.map(
        (c) => (JSON.parse(String(c[1]?.body)) as { model: string }).model,
      ),
    ).toEqual([
      "qwen/qwen3.8-27b",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
    ]);
    expect(
      warnSpy.mock.calls.some((args) => String(args[0]).includes("vòng 2/2")),
    ).toBe(true);

    // When all providers have remaining cooldown > 65_000ms, throws immediately without sleeping
    const longCooldowns = new Map<string, number>([
      ["Groq-120B", fakeNowMs + 70_000],
      ["Groq-20B-Fast", fakeNowMs + 90_000],
      ["Groq-Qwen-27B", fakeNowMs + 180_000],
    ]);
    const noSleepMock = vi.fn(async () => undefined);
    await expect(
      classifyRepo(SAMPLE_INPUT, {
        env: { GROQ_API_KEY: FULL_MOCK_ENV.GROQ_API_KEY },
        fetchImpl: fetchMock,
        providerCooldowns: longCooldowns,
        sleep: noSleepMock,
        now: () => fakeNowMs,
      }),
    ).rejects.toThrow(/All AI providers failed/);
    expect(noSleepMock).not.toHaveBeenCalled();
  });

  it("classifies multiple repos via classifyRepoBatch, syncs category, and falls back individually for missing items", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const inputs: ClassifyRepoInput[] = [
      SAMPLE_INPUT,
      {
        name: "open-webui",
        fullName: "open-webui/open-webui",
        description: "User-friendly AI Interface",
        homepage: "https://openwebui.com",
        language: "Python",
        topics: ["llm", "webui"],
        readmeText: "Self-hosted AI WebUI.",
      },
      {
        name: "broken-repo",
        fullName: "acme/broken-repo",
        description: "Unreachable fallback test",
        language: "Rust",
        topics: ["cli"],
        readmeText: "CLI tool",
      },
    ];

    const fetchMock = vi
      .fn<typeof fetch>()
      // 1st call: batch returns 2 out of 3 repos (case-insensitive full_name + intentional mismatched category for open-webui)
      .mockResolvedValueOnce(
        makeChatCompletionResponse(
          JSON.stringify({
            results: [
              { full_name: "USEBRUNO/BRUNO", ...VALID_AI_PAYLOAD },
              {
                full_name: "open-webui/open-webui",
                summary_vi:
                  "Giao diện WebUI tự lưu trữ để trò chuyện với các mô hình AI local và API.",
                category: "other",
                sub_category: "ai-chat-ui",
                secondary_sub_categories: ["local-llm-gateway"],
                use_cases: ["Chat với AI nội bộ"],
                replaces: ["ChatGPT Plus"],
                usability: "app-ready",
              },
            ],
          }),
        ),
      )
      // 2nd call: individual fallback for missing acme/broken-repo fails on Groq-120B (500) -> succeeds on Groq-20B-Fast
      .mockResolvedValueOnce(new Response("Server error", { status: 500 }))
      .mockResolvedValueOnce(
        makeChatCompletionResponse(
          JSON.stringify({
            ...VALID_AI_PAYLOAD,
            category: "dev-engineering",
            sub_category: "cli-dev-env",
            secondary_sub_categories: [],
            usability: "cli-tool",
          }),
        ),
      );

    const outcomes = await classifyRepoBatch(inputs, {
      env: { GROQ_API_KEY: "gsk_mock_batch_key" },
      fetchImpl: fetchMock,
    });

    expect(outcomes).toHaveLength(3);
    expect(outcomes[0]).toMatchObject({
      fullName: "usebruno/bruno",
      ok: true,
      result: {
        provider: "Groq-120B",
        classification: { sub_category: "api-client-testing" },
      },
    });
    expect(outcomes[1]).toMatchObject({
      fullName: "open-webui/open-webui",
      ok: true,
      result: {
        provider: "Groq-120B",
        classification: {
          category: "ai-llm",
          sub_category: "ai-chat-ui",
        },
      },
    });
    expect(outcomes[2]).toMatchObject({
      fullName: "acme/broken-repo",
      ok: true,
      result: {
        provider: "Groq-20B-Fast",
        classification: {
          category: "dev-engineering",
          sub_category: "cli-dev-env",
          usability: "cli-tool",
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Also verify classifyRepoBatch sends max_tokens: 4096 on Gemini tiers
    const geminiBatchFetch = vi.fn<typeof fetch>(async () =>
      makeChatCompletionResponse(
        JSON.stringify({
          results: [
            { full_name: "usebruno/bruno", ...VALID_AI_PAYLOAD },
            { full_name: "open-webui/open-webui", ...VALID_AI_PAYLOAD },
          ],
        }),
      ),
    );
    const geminiBatchRes = await classifyRepoBatch(inputs.slice(0, 2), {
      env: { GEMINI_API_KEY: FULL_MOCK_ENV.GEMINI_API_KEY },
      fetchImpl: geminiBatchFetch,
    });
    expect(geminiBatchRes.every((item) => item.ok)).toBe(true);
    const geminiBatchBody = JSON.parse(
      String(geminiBatchFetch.mock.calls[0]?.[1]?.body),
    ) as { max_tokens: number };
    expect(geminiBatchBody.max_tokens).toBe(GEMINI_BATCH_MAX_TOKENS);
  });
});
