export interface SubCategoryDefinition {
  readonly slug: string;
  readonly label: string;
  readonly hint: string;
}

export interface CategoryDefinition {
  readonly slug: string;
  readonly label: string;
  readonly subCategories: readonly SubCategoryDefinition[];
}

export const TAXONOMY = [
  {
    slug: "api-integration",
    label: "API & Tích hợp",
    subCategories: [
      {
        slug: "api-client-testing",
        label: "Test & Debug API",
        hint: "REST/GraphQL/gRPC client, thay Postman/Insomnia",
      },
      {
        slug: "api-gateway-webhook",
        label: "Nối API & Webhook",
        hint: "bắt webhook, tunneling localhost, proxy, thay ngrok",
      },
      {
        slug: "api-mock-docs",
        label: "Mock Server & Docs",
        hint: "giả lập API, tự sinh tài liệu OpenAPI/Swagger",
      },
      {
        slug: "auth-payment",
        label: "Auth & Thanh toán",
        hint: "OAuth, JWT, đăng nhập, cổng thanh toán",
      },
    ],
  },
  {
    slug: "automation-scraping",
    label: "Tự động hóa & Cào dữ liệu",
    subCategories: [
      {
        slug: "workflow-orchestration",
        label: "Luồng Workflow",
        hint: "nối nhiều app/API kiểu n8n, Zapier",
      },
      {
        slug: "web-scraping-browser",
        label: "Cào Web & Trình duyệt",
        hint: "crawler, browser automation, vượt anti-bot",
      },
      {
        slug: "chat-bot-notify",
        label: "Bot & Thông báo",
        hint: "bot Telegram/Discord, đẩy thông báo tự động",
      },
      {
        slug: "desktop-rpa",
        label: "Tự động hóa Desktop",
        hint: "macro chuột/phím, lập lịch tác vụ máy tính",
      },
    ],
  },
  {
    slug: "dev-engineering",
    label: "Phát triển Phần mềm",
    subCategories: [
      {
        slug: "ui-components-viz",
        label: "UI, Icon & Biểu đồ",
        hint: "component UI, animation, vẽ sơ đồ/chart",
      },
      {
        slug: "database-orm",
        label: "Database & ORM",
        hint: "quản trị DB, ORM, cache, đồng bộ dữ liệu",
      },
      {
        slug: "cli-dev-env",
        label: "CLI & Môi trường Dev",
        hint: "terminal, Git, quản lý file .env",
      },
      {
        slug: "testing-monitoring",
        label: "Test & Giám sát",
        hint: "test tự động, log viewer, đo hiệu năng",
      },
    ],
  },
  {
    slug: "ai-llm",
    label: "AI & Xử lý Tri thức",
    subCategories: [
      {
        slug: "local-llm-gateway",
        label: "AI Local & Gateway",
        hint: "chạy LLM offline, gom nhiều API AI về 1 đầu mối",
      },
      {
        slug: "ai-coding-agent",
        label: "AI Agent & Hỗ trợ Code",
        hint: "trợ lý lập trình, agent tự thực thi tác vụ",
      },
      {
        slug: "rag-ocr-extract",
        label: "OCR & Bóc tách dữ liệu",
        hint: "đọc PDF/ảnh, OCR, kho tri thức RAG",
      },
      {
        slug: "ai-voice-vision",
        label: "Giọng nói & Thị giác",
        hint: "STT, TTS, xử lý ảnh/video bằng AI",
      },
    ],
  },
  {
    slug: "media-docs",
    label: "Xử lý Media & Tài liệu",
    subCategories: [
      {
        slug: "video-audio-tools",
        label: "Video & Âm thanh",
        hint: "tải video/nhạc, cắt ghép, nén, phụ đề",
      },
      {
        slug: "image-svg-tools",
        label: "Ảnh & SVG",
        hint: "xóa nền, nén ảnh hàng loạt, tối ưu SVG",
      },
      {
        slug: "document-converter",
        label: "Chuyển đổi Tài liệu",
        hint: "PDF, Word, Excel, Markdown, tạo Slide",
      },
    ],
  },
  {
    slug: "infra-security",
    label: "Hạ tầng, Mạng & Bảo mật",
    subCategories: [
      {
        slug: "self-host-deploy",
        label: "Self-host & Deploy",
        hint: "deploy Docker/VPS tự động, thay Vercel/Heroku",
      },
      {
        slug: "network-proxy-vpn",
        label: "Mạng, Proxy & VPN",
        hint: "VPN, proxy, DNS, đo kiểm mạng",
      },
      {
        slug: "security-vault",
        label: "Bảo mật & Mật khẩu",
        hint: "quản lý mật khẩu, mã hóa, quét lỗ hổng",
      },
    ],
  },
  {
    slug: "productivity-os",
    label: "Năng suất & Tiện ích Máy",
    subCategories: [
      {
        slug: "pkm-study-notes",
        label: "Ghi chú & Học tập",
        hint: "note, flashcard, quản lý công việc",
      },
      {
        slug: "os-desktop-utility",
        label: "Tiện ích Hệ điều hành",
        hint: "quản lý cửa sổ, clipboard, launcher",
      },
      {
        slug: "file-sync-share",
        label: "Đồng bộ & Truyền file",
        hint: "gửi file đa thiết bị, backup dữ liệu",
      },
    ],
  },
] as const satisfies readonly CategoryDefinition[];

export type CategorySlug = (typeof TAXONOMY)[number]["slug"];
export type SubCategorySlug =
  (typeof TAXONOMY)[number]["subCategories"][number]["slug"];

export interface SubCategoryMeta {
  readonly slug: SubCategorySlug;
  readonly label: string;
  readonly hint: string;
  readonly category: CategorySlug;
  readonly categoryLabel: string;
}

function toNonEmptyTuple<T extends string>(
  items: readonly T[],
  name: string,
): readonly [T, ...T[]] {
  const [first, ...rest] = items;
  if (first === undefined) {
    throw new Error(`${name} must not be empty`);
  }
  return Object.freeze([first, ...rest] satisfies readonly [T, ...T[]]);
}

export const VALID_CATEGORIES: readonly [CategorySlug, ...CategorySlug[]] =
  toNonEmptyTuple(
    TAXONOMY.map((cat) => cat.slug),
    "VALID_CATEGORIES",
  );

export const VALID_SUB_CATEGORIES: readonly [
  SubCategorySlug,
  ...SubCategorySlug[],
] = toNonEmptyTuple(
  TAXONOMY.flatMap((cat) => cat.subCategories.map((sub) => sub.slug)),
  "VALID_SUB_CATEGORIES",
);

export const CATEGORY_MAP = Object.freeze(
  Object.fromEntries(TAXONOMY.map((cat) => [cat.slug, cat])) as Record<
    CategorySlug,
    (typeof TAXONOMY)[number]
  >,
);

export const SUB_CATEGORY_MAP = Object.freeze(
  Object.fromEntries(
    TAXONOMY.flatMap((cat) =>
      cat.subCategories.map((sub) => [
        sub.slug,
        {
          slug: sub.slug,
          label: sub.label,
          hint: sub.hint,
          category: cat.slug,
          categoryLabel: cat.label,
        } satisfies SubCategoryMeta,
      ]),
    ),
  ) as Record<SubCategorySlug, SubCategoryMeta>,
);

export const SUB_CATEGORY_TO_CATEGORY = Object.freeze(
  Object.fromEntries(
    TAXONOMY.flatMap((cat) =>
      cat.subCategories.map((sub) => [sub.slug, cat.slug]),
    ),
  ) as Record<SubCategorySlug, CategorySlug>,
);

const VALID_CATEGORY_SET = new Set<string>(VALID_CATEGORIES);
const VALID_SUB_CATEGORY_SET = new Set<string>(VALID_SUB_CATEGORIES);

/** Kiểm tra chuỗi có thuộc 7 slug nhóm lớn hợp lệ hay không. */
export function isValidCategory(value: string): value is CategorySlug {
  return VALID_CATEGORY_SET.has(value);
}

/** Kiểm tra chuỗi có thuộc 25 slug ngách chuyên sâu hợp lệ hay không. */
export function isValidSubCategory(value: string): value is SubCategorySlug {
  return VALID_SUB_CATEGORY_SET.has(value);
}

export const TAXONOMY_PROMPT_GUIDE: string = TAXONOMY.map((cat, index) => {
  const header = `${index + 1}. ${cat.slug} (${cat.label}):`;
  const subLines = cat.subCategories
    .map((sub) => `   - ${sub.slug} (${sub.label}): ${sub.hint}`)
    .join("\n");
  return `${header}\n${subLines}`;
}).join("\n");
