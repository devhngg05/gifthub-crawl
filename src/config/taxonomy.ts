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
        label: "API Gateway, Proxy & Webhook",
        hint: "bắt webhook, tunneling localhost, API gateway, thay ngrok",
      },
      {
        slug: "api-mock-docs",
        label: "Mock Server & OpenAPI Docs",
        hint: "giả lập API, tự sinh tài liệu OpenAPI/Swagger/Scalar",
      },
      {
        slug: "auth-payment",
        label: "Xác thực, SSO & Thanh toán",
        hint: "OAuth, OIDC, JWT, passkey, hệ thống đăng nhập, cổng thanh toán",
      },
    ],
  },
  {
    slug: "automation-scraping",
    label: "Tự động hóa & Cào dữ liệu",
    subCategories: [
      {
        slug: "workflow-orchestration",
        label: "Luồng Workflow & No-code",
        hint: "nối nhiều app/API kiểu n8n, Zapier, Activepieces, tự động hóa nghiệp vụ",
      },
      {
        slug: "web-scraping-browser",
        label: "Cào Web & Trình duyệt Tự động",
        hint: "web crawler, scraper, Playwright/Puppeteer automation, trích xuất web",
      },
      {
        slug: "chat-bot-notify",
        label: "Bot & Đẩy Thông báo",
        hint: "bot Telegram/Discord/Slack, máy chủ đẩy thông báo tự động (ntfy, Gotify)",
      },
      {
        slug: "desktop-rpa",
        label: "Tự động hóa Desktop & RPA",
        hint: "macro chuột/phím, kịch bản tự động thao tác máy tính, lập lịch tác vụ",
      },
    ],
  },
  {
    slug: "dev-engineering",
    label: "Phát triển Phần mềm",
    subCategories: [
      {
        slug: "ui-components-viz",
        label: "UI, Icon & Thiết kế Web",
        hint: "thư viện component UI, hệ thống thiết kế, animation, bộ icon",
      },
      {
        slug: "database-orm",
        label: "Database, ORM & Cache",
        hint: "hệ quản trị CSDL, ORM, migration, công cụ GUI quản trị DB, Redis/cache",
      },
      {
        slug: "cli-dev-env",
        label: "CLI, Terminal & Git",
        hint: "shell, terminal emulator, công cụ Git, quản lý dotfiles/.env, CLI tiện ích cho dev",
      },
      {
        slug: "testing-monitoring",
        label: "Kiểm thử & Giám sát (Observability)",
        hint: "test tự động (E2E/unit), log viewer, APM, tracing, theo dõi uptime/metrics",
      },
      {
        slug: "web-frameworks-runtime",
        label: "Web Framework & Runtime",
        hint: "framework full-stack/backend/frontend, bundler, build tool, runtime JS/TS/Go/Rust",
      },
      {
        slug: "code-quality-docs",
        label: "Phân tích Code & Tài liệu Kỹ thuật",
        hint: "linter, formatter, static analysis, trình tạo docs/wiki kỹ thuật, quản lý monorepo",
      },
    ],
  },
  {
    slug: "ai-llm",
    label: "AI & LLM",
    subCategories: [
      {
        slug: "local-llm-gateway",
        label: "AI Local, Inference & Gateway",
        hint: "chạy LLM cục bộ, inference engine & API gateway như Ollama, vLLM, llama.cpp, LiteLLM",
      },
      {
        slug: "ai-chat-ui",
        label: "Giao diện Chat AI & WebUI",
        hint: "giao diện chat đa model, WebUI & trợ lý AI cá nhân như Open WebUI, LobeChat, AnythingLLM",
      },
      {
        slug: "ai-coding-agent",
        label: "AI Hỗ trợ Code & IDE",
        hint: "CHỈ dành cho trợ lý lập trình, plugin IDE, agent viết/review code (Aider, Continue, Cline); không dùng cho app AI nói chung",
      },
      {
        slug: "ai-workflow-mcp",
        label: "MCP Server & AI Workflow",
        hint: "Model Context Protocol (MCP) server, điều phối Multi-Agent & luồng tác vụ AI",
      },
      {
        slug: "rag-ocr-extract",
        label: "RAG, Vector Search & OCR",
        hint: "RAG, tìm kiếm tri thức, vector search, đọc PDF/ảnh và trích xuất OCR sang Markdown/JSON",
      },
      {
        slug: "ai-voice-vision",
        label: "AI Ảnh, Video, Giọng nói & Thị giác",
        hint: "tạo/chỉnh sửa ảnh & video AI, ComfyUI, giọng nói TTS/STT (Whisper), thị giác máy tính",
      },
    ],
  },
  {
    slug: "media-docs",
    label: "Đa phương tiện & Sáng tạo",
    subCategories: [
      {
        slug: "video-audio-tools",
        label: "Video, Âm thanh & Streaming",
        hint: "tải video/nhạc, cắt ghép, chuyển mã FFmpeg, phát trực tiếp, tạo phụ đề",
      },
      {
        slug: "image-svg-tools",
        label: "Thiết kế, Ảnh & SVG",
        hint: "chỉnh sửa ảnh, vẽ vector, xóa nền, nén ảnh hàng loạt, tối ưu SVG",
      },
      {
        slug: "document-converter",
        label: "Tài liệu, PDF & Văn phòng",
        hint: "chuyển đổi PDF/Word/Excel/Markdown, soạn thảo slide, ký số/xử lý PDF",
      },
      {
        slug: "3d-game-engine",
        label: "Đồ họa 3D & Game Engine",
        hint: "game engine, dựng hình 3D, shader, công cụ phát triển game mã nguồn mở",
      },
      {
        slug: "media-server-streaming",
        label: "Media Server & Thư viện Ảnh/Nhạc",
        hint: "máy chủ phát phim/nhạc/ảnh cá nhân tự lưu trữ (Jellyfin, Immich, Navidrome)",
      },
    ],
  },
  {
    slug: "infra-security",
    label: "Hạ tầng, Cloud & Self-host",
    subCategories: [
      {
        slug: "self-host-deploy",
        label: "Self-host, PaaS & Deploy",
        hint: "deploy Docker/VPS tự động (Coolify, Dokploy), thay Vercel/Heroku",
      },
      {
        slug: "network-proxy-vpn",
        label: "Mạng, Proxy, DNS & VPN",
        hint: "VPN WireGuard/Tailscale, reverse proxy, chặn quảng cáo DNS, đo kiểm mạng",
      },
      {
        slug: "security-vault",
        label: "Quản lý Mật khẩu & Secrets",
        hint: "CHỈ dành cho trình quản lý mật khẩu, secrets manager & mã hóa khóa/biến môi trường (Vaultwarden, Infisical, SOPS); không dùng cho pentest/WAF/chat mã hóa",
      },
      {
        slug: "containers-homelab",
        label: "Container, Kubernetes & Homelab",
        hint: "quản lý Docker/Kubernetes, dashboard homelab, hạ tầng IaC (Terraform/Ansible)",
      },
    ],
  },
  {
    slug: "security-privacy",
    label: "Bảo mật & Quyền riêng tư",
    subCategories: [
      {
        slug: "pentest-vuln-scanner",
        label: "Quét Lỗ hổng & Pentest",
        hint: "quét bảo mật web/code/container, SAST/DAST, công cụ kiểm thử xâm nhập (trừ quản lý mật khẩu/secrets thì dùng security-vault)",
      },
      {
        slug: "firewall-siem-defense",
        label: "Tường lửa, SIEM & Phòng thủ",
        hint: "WAF, phát hiện xâm nhập (IDS/IPS), phân tích log bảo mật (SIEM), chống DDoS",
      },
      {
        slug: "privacy-encryption-comms",
        label: "Quyền riêng tư & Mã hóa Giao tiếp",
        hint: "ẩn danh, chặn theo dõi, chat/email mã hóa đầu cuối, bảo vệ quyền riêng tư người dùng cuối",
      },
    ],
  },
  {
    slug: "data-analytics",
    label: "Dữ liệu, BI & Phân tích",
    subCategories: [
      {
        slug: "data-pipeline-etl",
        label: "Data Pipeline, ETL & Streaming",
        hint: "đồng bộ dữ liệu, ETL/ELT, hàng đợi sự kiện, xử lý dữ liệu lớn",
      },
      {
        slug: "bi-analytics-dashboard",
        label: "BI Dashboard & Phân tích Web",
        hint: "bảng điều khiển BI (Metabase, Superset), web analytics thay Google Analytics (Umami, Plausible)",
      },
      {
        slug: "data-science-notebooks",
        label: "Khoa học Dữ liệu & Notebook",
        hint: "notebook tương tác, trực quan hóa số liệu, công cụ phân tích dữ liệu",
      },
    ],
  },
  {
    slug: "productivity-os",
    label: "Năng suất & Tiện ích Hệ thống",
    subCategories: [
      {
        slug: "pkm-study-notes",
        label: "Ghi chú, Knowledge & Học tập",
        hint: "second brain, ghi chú Markdown, wiki cá nhân, flashcard (Logseq, AppFlowy)",
      },
      {
        slug: "os-desktop-utility",
        label: "Tiện ích Hệ điều hành & Desktop",
        hint: "quản lý cửa sổ, clipboard, launcher, tiện ích Windows/macOS/Linux",
      },
      {
        slug: "file-sync-share",
        label: "Chia sẻ File, Đồng bộ & Backup",
        hint: "truyền file đa thiết bị, đồng bộ đám mây tự lưu trữ, sao lưu tự động",
      },
      {
        slug: "task-project-management",
        label: "Quản lý Công việc & Dự án",
        hint: "Kanban, issue tracker, lịch biểu, quản lý dự án thay Jira/Linear/Trello",
      },
      {
        slug: "rss-bookmarks-reading",
        label: "RSS, Bookmark & Đọc tin",
        hint: "trình đọc RSS, lưu bài đọc sau, quản lý bookmark cá nhân",
      },
    ],
  },
  {
    slug: "cms-collab-business",
    label: "Web, Cộng tác & Vận hành",
    subCategories: [
      {
        slug: "cms-blog-ecommerce",
        label: "CMS, Blog & Thương mại Điện tử",
        hint: "headless CMS, tạo blog/site tĩnh, giỏ hàng/bán hàng mã nguồn mở",
      },
      {
        slug: "team-chat-collab",
        label: "Cộng tác Nhóm & Giao tiếp",
        hint: "chat nhóm, họp video, bảng trắng (whiteboard), chia sẻ tài liệu nhóm",
      },
      {
        slug: "crm-erp-finance",
        label: "CRM, Tài chính & Vận hành",
        hint: "quản lý khách hàng (CRM), hóa đơn, kế toán/tài chính cá nhân & doanh nghiệp",
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

export const CATEGORY_SUB_CATEGORIES = Object.freeze(
  Object.fromEntries(
    TAXONOMY.map((cat) => [
      cat.slug,
      Object.freeze(cat.subCategories.map((sub) => sub.slug)),
    ]),
  ) as Record<CategorySlug, readonly SubCategorySlug[]>,
);

const VALID_CATEGORY_SET = new Set<string>(VALID_CATEGORIES);
const VALID_SUB_CATEGORY_SET = new Set<string>(VALID_SUB_CATEGORIES);

/** Kiểm tra chuỗi có thuộc 10 slug nhóm lớn hợp lệ hay không. */
export function isValidCategory(value: string): value is CategorySlug {
  return VALID_CATEGORY_SET.has(value);
}

/** Kiểm tra chuỗi có thuộc 43 slug ngách chuyên sâu hợp lệ hay không. */
export function isValidSubCategory(value: string): value is SubCategorySlug {
  return VALID_SUB_CATEGORY_SET.has(value);
}

/** Suy ra nhóm danh mục cha chuẩn từ `subCategory`; trả về `"other"` nếu không thuộc 43 ngách chuẩn. */
export function resolveCanonicalCategory(
  subCategory: string,
): CategorySlug | "other" {
  return isValidSubCategory(subCategory)
    ? SUB_CATEGORY_MAP[subCategory].category
    : "other";
}

export const TAXONOMY_PROMPT_GUIDE: string = TAXONOMY.map((cat, index) => {
  const header = `${index + 1}. ${cat.slug} (${cat.label}):`;
  const subLines = cat.subCategories
    .map((sub) => `   - ${sub.slug} (${sub.label}): ${sub.hint}`)
    .join("\n");
  return `${header}\n${subLines}`;
}).join("\n");

const COMPACT_SUB_CATEGORY_HINTS: Record<SubCategorySlug, string> = {
  "api-client-testing": "REST/GraphQL/gRPC client, Postman alt",
  "api-gateway-webhook": "API gateway, webhook, localhost tunnel",
  "api-mock-docs": "API mock server, OpenAPI/Swagger docs",
  "auth-payment": "OAuth, OIDC, JWT, passkey, payments",
  "workflow-orchestration": "no-code workflow, n8n/Zapier alt",
  "web-scraping-browser": "crawler, scraper, browser automation",
  "chat-bot-notify": "Telegram/Discord bot, push notifications",
  "desktop-rpa": "mouse/key macros, desktop automation",
  "ui-components-viz": "UI components, design system, icons",
  "database-orm": "DB engine, ORM, migration, DB GUI",
  "cli-dev-env": "terminal, shell, Git CLI, dotfiles",
  "testing-monitoring": "E2E/unit test, logs, APM, uptime",
  "web-frameworks-runtime": "web framework, bundler, JS/Go/Rust runtime",
  "code-quality-docs": "linter, formatter, code analysis, tech docs",
  "local-llm-gateway": "local LLM runtime, Ollama, inference, API gateway",
  "ai-chat-ui": "AI chat WebUI, Open WebUI, assistant",
  "ai-coding-agent": "ONLY IDE plugin, coding assistant/agent",
  "ai-workflow-mcp": "MCP server, multi-agent orchestration",
  "rag-ocr-extract": "RAG, vector search, PDF/image OCR",
  "ai-voice-vision": "AI image/video, ComfyUI, TTS, STT, vision",
  "video-audio-tools": "video/audio download, FFmpeg, subtitles",
  "image-svg-tools": "image editor, SVG optimizer, bg remove",
  "document-converter": "PDF/Office/Markdown converter, slides",
  "3d-game-engine": "3D graphics, shaders, game engine",
  "media-server-streaming": "self-hosted media server, Jellyfin/Immich",
  "self-host-deploy": "PaaS, Docker/VPS deploy, Vercel alt",
  "network-proxy-vpn": "VPN, reverse proxy, DNS, network",
  "security-vault": "ONLY password/secrets manager, env encryption",
  "containers-homelab": "Docker/K8s GUI, homelab dashboard, IaC",
  "pentest-vuln-scanner": "vuln scanner, SAST/DAST, pentesting",
  "firewall-siem-defense": "WAF, IDS/IPS, SIEM, DDoS defense",
  "privacy-encryption-comms": "privacy, tracker blocker, E2E encrypted chat",
  "data-pipeline-etl": "ETL/ELT, data pipeline, stream queue",
  "bi-analytics-dashboard": "BI dashboard, self-hosted web analytics",
  "data-science-notebooks": "data notebooks, visualization, analytics",
  "pkm-study-notes": "notes, Markdown PKM, wiki, flashcards",
  "os-desktop-utility": "window manager, clipboard, OS launcher",
  "file-sync-share": "file sharing, sync, self-hosted backup",
  "task-project-management": "Kanban, issue tracker, project management",
  "rss-bookmarks-reading": "RSS reader, read-it-later, bookmarks",
  "cms-blog-ecommerce": "headless CMS, static blog, e-commerce",
  "team-chat-collab": "team chat, video meetings, whiteboard",
  "crm-erp-finance": "CRM, invoicing, accounting, ERP",
};

/** Phiên bản Taxonomy siêu gọn (~600-800 token) tối ưu cho AI system prompt dưới trần TPM. */
export const TAXONOMY_COMPACT_GUIDE: string = TAXONOMY.map((cat) => {
  const subs = cat.subCategories
    .map((sub) => `${sub.slug}: ${COMPACT_SUB_CATEGORY_HINTS[sub.slug]}`)
    .join("\n");
  return `[${cat.slug}]\n${subs}`;
}).join("\n");

/** Từ khóa tích cực (song ngữ Việt–Anh, không chứa mệnh đề phủ định) dùng cho `search_text`. */
export const POSITIVE_CATEGORY_KEYWORDS: Readonly<Record<CategorySlug, string>> = {
  "api-integration": "api tich hop ket noi webhook gateway mock auth sso",
  "automation-scraping": "tu dong hoa workflow cao web scraping bot rpa",
  "dev-engineering": "phat trien phan mem lap trinh ui database orm cli terminal test giam sat framework",
  "ai-llm": "ai tri tue nhan tao llm chat agent mcp rag ocr giong noi hinh anh video",
  "media-docs": "da phuong tien video am thanh anh svg pdf tai lieu 3d game media server",
  "infra-security": "ha tang cloud self host deploy docker kubernetes homelab mang proxy vpn dns mat khau secrets",
  "security-privacy": "bao mat quyen rieng tu quet lo hong pentest tuong lua waf siem ma hoa",
  "data-analytics": "du lieu data etl pipeline bi dashboard thong ke phan tich notebook",
  "productivity-os": "nang suat ghi chu note kien thuc cong viec du an he dieu hanh chia se file sao luu rss bookmark",
  "cms-collab-business": "web cms blog thuong mai dien tu cong tac chat nhom crm tai chinh ke toan",
};

/** Từ khóa tích cực theo từng ngách (loại bỏ hoàn toàn câu cấm/phủ định gây nhiễu tìm kiếm). */
export const POSITIVE_SUB_CATEGORY_KEYWORDS: Readonly<
  Record<SubCategorySlug, string>
> = {
  "api-client-testing": "test debug api rest graphql grpc client postman insomnia hoppscotch bruno",
  "api-gateway-webhook": "noi api gateway webhook proxy localhost tunnel ngrok integration",
  "api-mock-docs": "mock server gia lap api openapi swagger scalar documentation",
  "auth-payment": "auth xac thuc dang nhap sso oauth oidc jwt passkey thanh toan payment",
  "workflow-orchestration": "luong workflow no code tu dong hoa ket noi app api n8n zapier activepieces",
  "web-scraping-browser": "cao web cao du lieu crawler scraper spider playwright puppeteer browser automation",
  "chat-bot-notify": "bot telegram discord slack thong bao day notification ntfy gotify",
  "desktop-rpa": "tu dong hoa desktop rpa macro chuot phim lap lich tac vu",
  "ui-components-viz": "ui component thiet ke web animation bieu do icon design system",
  "database-orm": "co so du lieu csdl database sql orm migration quan tri db redis cache",
  "cli-dev-env": "cli dong lenh terminal shell git dotfiles env moi truong dev",
  "testing-monitoring": "kiem thu test tu dong e2e unit giam sat monitoring log viewer apm tracing uptime metrics",
  "web-frameworks-runtime": "web framework fullstack backend frontend bundler build tool runtime",
  "code-quality-docs": "phan tich code linter formatter static analysis tai lieu ky thuat wiki monorepo",
  "local-llm-gateway": "chay ai local cuc bo offline llm inference engine api gateway ollama vllm llamacpp litellm",
  "ai-chat-ui": "giao dien chat ai webui tro ly ai open webui lobechat anythingllm",
  "ai-coding-agent": "ai ho tro code lap trinh ide plugin coding agent aider cline",
  "ai-workflow-mcp": "mcp server model context protocol ai workflow multi agent dieu phoi",
  "rag-ocr-extract": "rag tim kiem tri thuc vector search doc pdf anh trich xuat ocr markdown",
  "ai-voice-vision": "ai anh video giong noi thi giac may tinh comfyui tts stt whisper",
  "video-audio-tools": "video am thanh nhac tai video cat ghep ffmpeg streaming phu de",
  "image-svg-tools": "thiet ke chinh sua anh ve vector xoa nen nen anh toi uu svg",
  "document-converter": "tai lieu pdf word excel markdown chuyen doi slide ky so van phong",
  "3d-game-engine": "do hoa 3d game engine shader dung hinh",
  "media-server-streaming": "media server phat phim nhac thu vien anh tu luu tru jellyfin immich navidrome",
  "self-host-deploy": "self host paas deploy trien khai docker vps coolify dokploy vercel alt",
  "network-proxy-vpn": "mang network proxy reverse proxy dns vpn wireguard tailscale chan quang cao",
  "security-vault": "quan ly mat khau password manager secrets vault ma hoa khoa bien moi truong vaultwarden bitwarden infisical",
  "containers-homelab": "container docker kubernetes k8s homelab dashboard iac terraform ansible",
  "pentest-vuln-scanner": "quet lo hong bao mat pentest sast dast kiem thu xam nhap",
  "firewall-siem-defense": "tuong lua firewall waf phat hien xam nhap ids ips siem chong ddos",
  "privacy-encryption-comms": "quyen rieng tu privacy an danh chan theo doi ma hoa dau cuoi e2e",
  "data-pipeline-etl": "data pipeline etl elt dong bo du lieu hang doi su kien streaming",
  "bi-analytics-dashboard": "bi dashboard bieu do thong ke phan tich web analytics metabase superset umami plausible",
  "data-science-notebooks": "khoa hoc du lieu notebook truc quan hoa so lieu phan tich",
  "pkm-study-notes": "ghi chu note second brain markdown wiki ca nhan kien thuc hoc tap flashcard notion logseq",
  "os-desktop-utility": "tien ich he dieu hanh desktop quan ly cua so clipboard launcher windows macos linux",
  "file-sync-share": "chia se file truyen file dong bo dam may sao luu backup tu dong",
  "task-project-management": "quan ly cong viec du an kanban issue tracker lich bieu jira linear trello",
  "rss-bookmarks-reading": "rss doc tin luu bai doc sau quan ly bookmark",
  "cms-blog-ecommerce": "cms headless blog site tinh thuong mai dien tu gio hang ban hang",
  "team-chat-collab": "cong tac nhom chat nhom hop video bang trang whiteboard chia se tai lieu",
  "crm-erp-finance": "crm erp quan ly khach hang hoa don ke toan tai chinh van hanh",
};
