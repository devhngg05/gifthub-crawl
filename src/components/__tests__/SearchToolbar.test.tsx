// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchToolbar } from "@/components/SearchToolbar";
import { parseUrlSearchParams } from "@/lib/ui-helpers";

const mockPush = vi.fn();
const mockReplace = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
  useSearchParams: () => currentSearchParams,
}));

interface MockLinkProps {
  href: string | { pathname?: string };
  children: ReactNode;
  prefetch?: boolean;
  scroll?: boolean;
  className?: string;
  onClick?: () => void;
  "aria-current"?: "true" | "false" | "page" | "step" | "location" | "date" | "time";
}

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    prefetch: _prefetch,
    scroll: _scroll,
    ...rest
  }: MockLinkProps) => {
    void _prefetch;
    void _scroll;
    const resolvedHref =
      typeof href === "string" ? href : (href.pathname ?? "/");
    return createElement("a", { ...rest, href: resolvedHref }, children);
  },
}));

const SUGGEST_RESPONSE_PAYLOAD = {
  categories: [
    {
      slug: "local-llm-gateway",
      label: "Chạy LLM Local & Gateway",
      categoryLabel: "AI & LLM",
    },
  ],
  tools: [
    {
      id: 101,
      name: "ollama",
      fullName: "ollama/ollama",
      summaryVi: "Chạy và quản lý mô hình LLM cục bộ qua CLI và API.",
      subCategory: "local-llm-gateway",
      stars: 145000,
      usability: "cli-tool",
    },
    {
      id: 102,
      name: "vllm",
      fullName: "vllm-project/vllm",
      summaryVi: "Engine suy luận LLM hiệu năng cao tương thích OpenAI API.",
      subCategory: "local-llm-gateway",
      stars: 52000,
      usability: "dev-required",
    },
  ],
};

function createJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function setupUserWithFakeTimers() {
  return userEvent.setup({
    advanceTimers: (ms) => vi.advanceTimersByTime(ms),
  });
}

function renderToolbar(queryString = "", resultCount = 12) {
  currentSearchParams = new URLSearchParams(queryString);
  const filters = parseUrlSearchParams(currentSearchParams);
  return render(<SearchToolbar filters={filters} resultCount={resultCount} />);
}

describe("SearchToolbar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("jest", {
      advanceTimersByTime: vi.advanceTimersByTime.bind(vi),
    });
    currentSearchParams = new URLSearchParams();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("gõ từ khóa gọi GET /api/tools/suggest?q=... sau debounce 200ms và hiển thị ngách + công cụ gợi ý", async () => {
    const user = setupUserWithFakeTimers();
    const fetchMock = vi.fn(async () =>
      createJsonResponse(SUGGEST_RESPONSE_PAYLOAD),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderToolbar();
    const input = screen.getByRole("combobox", { name: "Tìm kiếm công cụ" });

    // Ít hơn 2 ký tự -> không gọi suggest
    await user.type(input, "a");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Gõ đủ từ khóa -> chưa gọi trước 200ms
    await user.clear(input);
    await user.type(input, "ai local");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Sau mốc 200ms -> gọi đúng endpoint và render dropdown
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/tools/suggest?q=ai%20local", {
      signal: expect.any(AbortSignal),
    });

    const listbox = screen.getByRole("listbox", { name: "Gợi ý tìm kiếm" });
    expect(listbox).toBeInTheDocument();
    expect(screen.getByText("Ngách gợi ý")).toBeInTheDocument();
    expect(screen.getByText("Chạy LLM Local & Gateway")).toBeInTheDocument();
    expect(screen.getByText("Công cụ phù hợp")).toBeInTheDocument();
    expect(screen.getByText("ollama")).toBeInTheDocument();
    expect(screen.getByText("(ollama/ollama)")).toBeInTheDocument();
    expect(screen.getByText("145k")).toBeInTheDocument();
  });

  it("bấm chọn 1 công cụ trong dropdown sẽ đẩy URL sạch /?q=<fullName> (xóa lọc cũ) và đóng dropdown", async () => {
    const user = setupUserWithFakeTimers();
    const fetchMock = vi.fn(async () =>
      createJsonResponse(SUGGEST_RESPONSE_PAYLOAD),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderToolbar(
      "category=ai-llm&subCategory=ai-coding-agent&usability=cli-tool&pinned=true&sort=recent",
    );

    const input = screen.getByRole("combobox", { name: "Tìm kiếm công cụ" });
    await user.type(input, "ollama");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    const toolOption = screen.getByRole("option", { name: /ollama\/ollama/i });
    await user.click(toolOption);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/?q=ollama%2Follama", {
      scroll: false,
    });
    expect(input).toHaveValue("ollama/ollama");
    expect(
      screen.queryByRole("listbox", { name: "Gợi ý tìm kiếm" }),
    ).not.toBeInTheDocument();
  });

  it("bấm nút X xóa từ khóa sẽ xóa q khỏi URL, giữ bộ lọc còn lại và đóng dropdown", async () => {
    const user = setupUserWithFakeTimers();
    const fetchMock = vi.fn(async () =>
      createJsonResponse(SUGGEST_RESPONSE_PAYLOAD),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderToolbar("q=docker&category=infra-security");

    const input = screen.getByRole("combobox", { name: "Tìm kiếm công cụ" });
    expect(input).toHaveValue("docker");

    // Mở dropdown gợi ý trước khi bấm nút X để kiểm tra đóng dropdown
    await user.type(input, " compose");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(
      screen.getByRole("listbox", { name: "Gợi ý tìm kiếm" }),
    ).toBeInTheDocument();

    const clearButton = screen.getByRole("button", {
      name: "Xóa từ khóa tìm kiếm",
    });
    await user.click(clearButton);

    expect(input).toHaveValue("");
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/?category=infra-security", {
      scroll: false,
    });
    expect(
      screen.queryByRole("listbox", { name: "Gợi ý tìm kiếm" }),
    ).not.toBeInTheDocument();
  });

  it("xóa trắng input rồi nhấn Enter khi URL đang có q sẽ xóa q khỏi URL và đóng dropdown", async () => {
    const user = setupUserWithFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createJsonResponse(SUGGEST_RESPONSE_PAYLOAD)),
    );

    renderToolbar("q=docker");

    const input = screen.getByRole("combobox", { name: "Tìm kiếm công cụ" });
    await user.clear(input);
    await user.keyboard("{Enter}");

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/", { scroll: false });
    expect(
      screen.queryByRole("listbox", { name: "Gợi ý tìm kiếm" }),
    ).not.toBeInTheDocument();
  });

  it("điều hướng bàn phím ArrowDown -> Enter chọn đúng mục và Escape đóng dropdown", async () => {
    const user = setupUserWithFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createJsonResponse(SUGGEST_RESPONSE_PAYLOAD)),
    );

    const { unmount } = renderToolbar();
    const input = screen.getByRole("combobox", { name: "Tìm kiếm công cụ" });

    await user.type(input, "llm");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    // ArrowDown lần 1 -> chọn ngách gợi ý (index 0)
    await user.keyboard("{ArrowDown}");
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "search-suggest-option-0",
    );

    // ArrowDown lần 2 -> chuyển xuống công cụ đầu tiên ollama/ollama (index 1)
    await user.keyboard("{ArrowDown}");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "search-suggest-option-1",
    );

    // Enter -> điều hướng theo công cụ đang highlight và đóng dropdown
    await user.keyboard("{Enter}");
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/?q=ollama%2Follama", {
      scroll: false,
    });
    expect(
      screen.queryByRole("listbox", { name: "Gợi ý tìm kiếm" }),
    ).not.toBeInTheDocument();
    unmount();

    // Kiểm tra ArrowDown -> Enter cho mục ngách gợi ý và Escape đóng dropdown
    mockPush.mockClear();
    renderToolbar();
    const freshInput = screen.getByRole("combobox", {
      name: "Tìm kiếm công cụ",
    });
    await user.type(freshInput, "llm");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("listbox", { name: "Gợi ý tìm kiếm" }),
    ).not.toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();

    // ArrowDown mở lại dropdown từ trạng thái đóng và Enter chọn ngách đầu tiên
    await user.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("listbox", { name: "Gợi ý tìm kiếm" }),
    ).toBeInTheDocument();
    await user.keyboard("{Enter}");

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/?subCategory=local-llm-gateway", {
      scroll: false,
    });
  });

  it('hiển thị nhãn sắp xếp mặc định "Ghim & Nhiều sao nhất" trong nút và dropdown', async () => {
    const user = setupUserWithFakeTimers();
    renderToolbar();

    const sortButton = screen.getByRole("button", { name: /Sắp xếp:/i });
    expect(sortButton).toHaveTextContent("Ghim & Nhiều sao nhất");

    await user.click(sortButton);

    const sortListbox = screen.getByRole("listbox", {
      name: "Chọn thứ tự sắp xếp",
    });
    expect(sortListbox).toBeInTheDocument();

    const starsOption = screen.getByRole("option", {
      name: "Ghim & Nhiều sao nhất",
    });
    expect(starsOption).toHaveAttribute("aria-selected", "true");
  });
});
