import { afterEach, describe, expect, it, vi } from "vitest";
import { TAXONOMY_PROMPT_GUIDE } from "@/config/taxonomy";
import {
  buildChatCompletionsEndpoint,
  classifyRepo,
  DEFAULT_MAX_TOKENS,
  extractJsonFromModelOutput,
  getActiveProviders,
  MAX_ERROR_BODY_LENGTH,
  PROVIDERS,
  sanitizeResponseSnippet,
  stripMarkdownCodeFence,
  stripThinkTags,
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
  GROQ_API_KEY: "gsk_mock_groq_secret_value",
  OPENROUTER_API_KEY: "sk-or-mock_openrouter_secret_value",
};

function makeChatCompletionResponse(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifier — provider priority & env filtering", () => {
  it("filters out providers missing API keys at runtime while preserving exact 4-tier order", () => {
    expect(PROVIDERS.map((p) => p.name)).toEqual([
      "Groq-120B",
      "Groq-Qwen-27B",
      "Groq-20B-Fast",
      "OpenRouter-Free",
    ]);

    expect(PROVIDERS.map((p) => p.model)).toEqual([
      "openai/gpt-oss-120b",
      "qwen/qwen3.8-27b",
      "openai/gpt-oss-20b",
      "google/gemma-4-31b-it:free",
    ]);

    const onlyOpenRouter = getActiveProviders({
      OPENROUTER_API_KEY: "sk-or-test",
    });
    expect(onlyOpenRouter.map((p) => p.name)).toEqual(["OpenRouter-Free"]);

    const blankGroq = getActiveProviders({
      GROQ_API_KEY: "   ",
      OPENROUTER_API_KEY: "sk-or-test",
    });
    expect(blankGroq.map((p) => p.name)).toEqual(["OpenRouter-Free"]);

    const onlyGroq = getActiveProviders({
      GROQ_API_KEY: "gsk_test",
    });
    expect(onlyGroq.map((p) => p.name)).toEqual([
      "Groq-120B",
      "Groq-Qwen-27B",
      "Groq-20B-Fast",
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
  it("sends OpenAI-compatible /chat/completions request with max_tokens >= 2048 and TAXONOMY_PROMPT_GUIDE", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      makeChatCompletionResponse(
        `<think>Phân tích kỹ trước khi trả JSON</think>\n${JSON.stringify(VALID_AI_PAYLOAD)}`,
      ),
    );

    const result = await classifyRepo(SAMPLE_INPUT, {
      env: FULL_MOCK_ENV,
      fetchImpl: fetchMock,
    });

    expect(result.provider).toBe("Groq-120B");
    expect(result.classification.category).toBe("api-integration");
    expect(result.classification.sub_category).toBe("api-client-testing");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer gsk_mock_groq_secret_value",
    });

    const body = JSON.parse(String(init?.body)) as {
      model: string;
      temperature: number;
      max_tokens: number;
      response_format?: { type: string };
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("openai/gpt-oss-120b");
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(body.max_tokens).toBeGreaterThanOrEqual(2048);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[0]?.content).toContain(TAXONOMY_PROMPT_GUIDE);
    expect(body.messages[0]?.content).toContain("tiếng Việt");
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

  it("falls back sequentially across all 4 live providers with exact URLs and models", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      buildChatCompletionsEndpoint("https://api.groq.com/openai/v1/"),
    ).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(
      buildChatCompletionsEndpoint("https://openrouter.ai/api/v1/"),
    ).toBe("https://openrouter.ai/api/v1/chat/completions");

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(makeChatCompletionResponse("{ broken json"))
      .mockResolvedValueOnce(
        makeChatCompletionResponse(
          JSON.stringify({
            ...VALID_AI_PAYLOAD,
            summary_vi: "Quá ngắn",
            use_cases: [],
          }),
        ),
      )
      .mockResolvedValueOnce(
        makeChatCompletionResponse(
          `<think>gemma 4 thinking</think>\n${JSON.stringify(VALID_AI_PAYLOAD)}`,
        ),
      );

    const result = await classifyRepo(SAMPLE_INPUT, {
      env: FULL_MOCK_ENV,
      fetchImpl: fetchMock,
    });

    expect(result.provider).toBe("OpenRouter-Free");
    expect(result.classification.replaces).toEqual(["Postman", "Insomnia"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://api.groq.com/openai/v1/chat/completions",
      "https://api.groq.com/openai/v1/chat/completions",
      "https://api.groq.com/openai/v1/chat/completions",
      "https://openrouter.ai/api/v1/chat/completions",
    ]);

    expect(
      fetchMock.mock.calls.map(
        (call) =>
          (JSON.parse(String(call[1]?.body)) as { model: string }).model,
      ),
    ).toEqual([
      "openai/gpt-oss-120b",
      "qwen/qwen3.8-27b",
      "openai/gpt-oss-20b",
      "google/gemma-4-31b-it:free",
    ]);
  });

  it("throws descriptive error with sanitized snippets (<= 200 chars) without leaking secrets when all 4 providers fail", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const longBodyWithSecret = `{"error":{"message":"Model not found for Bearer ${FULL_MOCK_ENV.GROQ_API_KEY} ${"x".repeat(300)}"}}`;
    expect(
      sanitizeResponseSnippet(longBodyWithSecret, FULL_MOCK_ENV.GROQ_API_KEY)
        .length,
    ).toBeLessThanOrEqual(MAX_ERROR_BODY_LENGTH);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(longBodyWithSecret, { status: 404 }))
      .mockResolvedValueOnce(new Response("Bad Gateway", { status: 502 }))
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockResolvedValueOnce(makeChatCompletionResponse("not-json-at-all"));

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
    expect(message).toContain(
      "Groq-120B: HTTP 404 [https://api.groq.com/openai/v1/chat/completions] (",
    );
    expect(message).toContain("...");
    expect(message).toContain(
      "Groq-Qwen-27B: HTTP 502 [https://api.groq.com/openai/v1/chat/completions] (Bad Gateway)",
    );
    expect(message).toContain("Groq-20B-Fast: ETIMEDOUT");
    expect(message).toContain("OpenRouter-Free: Invalid JSON returned by model");

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
});
