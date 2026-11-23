import type { SubCategorySlug } from "@/config/taxonomy";

export interface SynonymConceptEntry {
  readonly triggers: readonly string[];
  readonly synonyms: readonly string[];
  readonly subCategories?: readonly SubCategorySlug[];
}

/**
 * Từ điển đồng nghĩa & ánh xạ ý định song ngữ (Việt ↔ Anh + Taxonomy) với >50 nhóm khái niệm thực tế.
 */
export const SYNONYM_CONCEPT_ENTRIES: readonly SynonymConceptEntry[] = [
  // 1. Nối & Tích hợp
  {
    triggers: [
      "noi",
      "ket noi",
      "gan",
      "lien ket",
      "tich hop",
      "dong bo",
      "bridge",
      "connector",
      "integration",
      "pipe",
    ],
    synonyms: [
      "noi",
      "ket noi",
      "tich hop",
      "dong bo",
      "webhook",
      "gateway",
      "connector",
      "integration",
      "workflow",
      "mcp",
      "bridge",
      "sync",
      "pipe",
    ],
    subCategories: [
      "api-gateway-webhook",
      "workflow-orchestration",
      "api-client-testing",
      "ai-workflow-mcp",
    ],
  },
  // 2. API & REST / GraphQL / gRPC
  {
    triggers: ["api", "goi api", "rest", "graphql", "grpc", "endpoint"],
    synonyms: ["api", "rest", "graphql", "grpc", "http", "endpoint"],
    subCategories: [
      "api-client-testing",
      "api-gateway-webhook",
      "api-mock-docs",
    ],
  },
  // 3. Test & Debug API
  {
    triggers: ["test api", "debug api", "kiem thu api", "api client"],
    synonyms: [
      "api",
      "test",
      "debug",
      "client",
      "rest",
      "graphql",
      "postman",
      "insomnia",
      "bruno",
      "hoppscotch",
    ],
    subCategories: ["api-client-testing"],
  },
  // 4. Mock API & OpenAPI Docs
  {
    triggers: ["mock api", "gia lap api", "openapi", "swagger", "mock server"],
    synonyms: ["mock", "gia lap", "openapi", "swagger", "docs", "schema"],
    subCategories: ["api-mock-docs"],
  },
  // 5. Webhook & Tunnel
  {
    triggers: ["webhook", "tunnel", "tunneling", "localhost", "gateway"],
    synonyms: ["webhook", "tunnel", "gateway", "proxy", "ngrok", "localhost"],
    subCategories: ["api-gateway-webhook"],
  },
  // 6. Auth, SSO & Thanh toán
  {
    triggers: [
      "auth",
      "xac thuc",
      "dang nhap",
      "sso",
      "oauth",
      "jwt",
      "passkey",
      "thanh toan",
      "payment",
    ],
    synonyms: [
      "auth",
      "xac thuc",
      "dang nhap",
      "sso",
      "oauth",
      "oidc",
      "jwt",
      "passkey",
      "payment",
      "thanh toan",
    ],
    subCategories: ["auth-payment"],
  },
  // 7. Workflow & No-code Automation
  {
    triggers: ["workflow", "luong", "no code", "nocode", "n8n", "zapier"],
    synonyms: [
      "workflow",
      "luong",
      "tu dong hoa",
      "automation",
      "no code",
      "n8n",
      "zapier",
      "orchestration",
    ],
    subCategories: ["workflow-orchestration"],
  },
  // 8. Cào web & Crawler
  {
    triggers: [
      "cao",
      "cao web",
      "cao du lieu",
      "quet web",
      "scraping",
      "scraper",
      "crawler",
      "crawl",
      "spider",
    ],
    synonyms: [
      "cao",
      "cao web",
      "scraping",
      "scraper",
      "crawler",
      "crawl",
      "spider",
      "playwright",
      "puppeteer",
      "browser",
      "trinh duyet",
    ],
    subCategories: ["web-scraping-browser"],
  },
  // 9. Trình duyệt tự động
  {
    triggers: ["trinh duyet", "browser", "playwright", "puppeteer", "selenium"],
    synonyms: [
      "browser",
      "trinh duyet",
      "playwright",
      "puppeteer",
      "selenium",
      "automation",
      "scraping",
    ],
    subCategories: ["web-scraping-browser"],
  },
  // 10. Tự động hóa chung
  {
    triggers: ["tu dong", "tu dong hoa", "automation", "rpa", "macro"],
    synonyms: [
      "tu dong",
      "tu dong hoa",
      "automation",
      "workflow",
      "rpa",
      "macro",
      "bot",
      "script",
    ],
    subCategories: ["workflow-orchestration", "desktop-rpa"],
  },
  // 11. Bot & Thông báo
  {
    triggers: [
      "bot",
      "thong bao",
      "notification",
      "notify",
      "telegram",
      "discord",
      "slack",
    ],
    synonyms: [
      "bot",
      "thong bao",
      "notification",
      "notify",
      "telegram",
      "discord",
      "slack",
      "webhook",
    ],
    subCategories: ["chat-bot-notify", "team-chat-collab"],
  },
  // 12. AI tổng quát
  {
    triggers: ["ai", "tri tue nhan tao", "llm", "machine learning"],
    synonyms: ["ai", "llm", "tri tue nhan tao", "agent", "model", "gpt"],
    subCategories: [
      "local-llm-gateway",
      "ai-chat-ui",
      "ai-coding-agent",
      "ai-workflow-mcp",
      "rag-ocr-extract",
      "ai-voice-vision",
    ],
  },
  // 13. Chạy AI local / cục bộ
  {
    triggers: [
      "chay ai local",
      "chay ai cuc bo",
      "ai local",
      "cuc bo",
      "local",
      "offline",
      "ollama",
      "vllm",
      "llamacpp",
    ],
    synonyms: [
      "local",
      "cuc bo",
      "offline",
      "ollama",
      "vllm",
      "inference",
      "gateway",
      "llm",
      "self host",
    ],
    subCategories: ["local-llm-gateway", "ai-chat-ui"],
  },
  // 14. Chat AI & WebUI
  {
    triggers: ["chat ai", "chatgpt", "webui", "tro ly ai", "assistant"],
    synonyms: ["chat", "webui", "assistant", "tro ly", "ai", "llm", "chatgpt"],
    subCategories: ["ai-chat-ui"],
  },
  // 15. Chat chung
  {
    triggers: ["chat", "nhan tin", "tro chuyen"],
    synonyms: ["chat", "messaging", "nhan tin", "team", "webui"],
    subCategories: ["ai-chat-ui", "team-chat-collab", "privacy-encryption-comms"],
  },
  // 16. Viết code / Lập trình AI
  {
    triggers: [
      "viet code",
      "code",
      "lap trinh",
      "coding",
      "ide",
      "copilot",
      "cursor",
    ],
    synonyms: [
      "code",
      "coding",
      "lap trinh",
      "ide",
      "developer",
      "copilot",
      "agent",
      "linter",
    ],
    subCategories: [
      "ai-coding-agent",
      "cli-dev-env",
      "code-quality-docs",
      "web-frameworks-runtime",
    ],
  },
  // 17. MCP & AI Agent
  {
    triggers: ["mcp", "agent", "multi agent", "model context protocol"],
    synonyms: ["mcp", "agent", "workflow", "orchestration", "ai", "tool"],
    subCategories: ["ai-workflow-mcp", "ai-coding-agent"],
  },
  // 18. OCR & Đọc tài liệu
  {
    triggers: ["ocr", "doc tai lieu", "nhan dang chu", "extract", "boc tach"],
    synonyms: ["ocr", "extract", "pdf", "markdown", "rag", "document", "parse"],
    subCategories: ["rag-ocr-extract", "document-converter"],
  },
  // 19. RAG & Vector Search
  {
    triggers: ["rag", "vector", "embedding", "tim kiem tri thuc", "semantic"],
    synonyms: ["rag", "vector", "embedding", "knowledge", "search", "tri thuc"],
    subCategories: ["rag-ocr-extract"],
  },
  // 20. Giọng nói TTS / STT
  {
    triggers: [
      "giong noi",
      "voice",
      "tts",
      "stt",
      "speech",
      "whisper",
      "chuyen giong noi",
    ],
    synonyms: [
      "voice",
      "giong noi",
      "tts",
      "stt",
      "speech",
      "audio",
      "whisper",
      "transcription",
    ],
    subCategories: ["ai-voice-vision", "video-audio-tools"],
  },
  // 21. Tạo ảnh / AI Ảnh
  {
    triggers: [
      "tao anh",
      "sinh anh",
      "ve anh",
      "ai anh",
      "stable diffusion",
      "comfyui",
    ],
    synonyms: [
      "image",
      "anh",
      "diffusion",
      "comfyui",
      "vision",
      "generation",
      "ai",
    ],
    subCategories: ["ai-voice-vision", "image-svg-tools"],
  },
  // 22. Chỉnh sửa ảnh & SVG
  {
    triggers: ["chinh sua anh", "anh", "image", "photo", "svg", "xoa nen"],
    synonyms: ["image", "photo", "anh", "svg", "editor", "compress", "vector"],
    subCategories: ["image-svg-tools", "media-server-streaming"],
  },
  // 23. Tạo video & Cắt/Tải video
  {
    triggers: ["tao video", "cat video", "tai video", "video", "ffmpeg", "phu de"],
    synonyms: [
      "video",
      "ffmpeg",
      "stream",
      "download",
      "subtitle",
      "phu de",
      "media",
    ],
    subCategories: [
      "video-audio-tools",
      "media-server-streaming",
      "ai-voice-vision",
    ],
  },
  // 24. Âm thanh / Nhạc
  {
    triggers: ["am thanh", "nhac", "audio", "music", "podcast"],
    synonyms: ["audio", "music", "sound", "am thanh", "nhac", "streaming"],
    subCategories: ["video-audio-tools", "media-server-streaming"],
  },
  // 25. Media Server (Jellyfin, Immich)
  {
    triggers: ["media server", "phat phim", "thu vien anh", "jellyfin", "immich"],
    synonyms: ["media", "server", "streaming", "photos", "movies", "music"],
    subCategories: ["media-server-streaming"],
  },
  // 26. 3D & Game Engine
  {
    triggers: ["3d", "game", "game engine", "shader", "do hoa"],
    synonyms: ["3d", "game", "engine", "shader", "graphics", "rendering"],
    subCategories: ["3d-game-engine"],
  },
  // 27. Cơ sở dữ liệu & ORM
  {
    triggers: [
      "co so du lieu",
      "csdl",
      "database",
      "db",
      "sql",
      "postgres",
      "mysql",
      "sqlite",
      "orm",
      "redis",
      "cache",
    ],
    synonyms: [
      "database",
      "db",
      "sql",
      "orm",
      "postgres",
      "sqlite",
      "mysql",
      "redis",
      "cache",
      "migration",
    ],
    subCategories: ["database-orm"],
  },
  // 28. Biểu đồ, BI, Thống kê & Phân tích
  {
    triggers: [
      "bieu do",
      "thong ke",
      "phan tich",
      "bao cao",
      "bi",
      "dashboard",
      "analytics",
      "chart",
    ],
    synonyms: [
      "bi",
      "analytics",
      "dashboard",
      "chart",
      "bieu do",
      "thong ke",
      "phan tich",
      "metrics",
      "visualization",
    ],
    subCategories: [
      "bi-analytics-dashboard",
      "data-science-notebooks",
      "ui-components-viz",
    ],
  },
  // 29. Data Pipeline & ETL
  {
    triggers: ["etl", "elt", "pipeline", "data pipeline", "streaming", "kafka"],
    synonyms: ["etl", "elt", "pipeline", "data", "streaming", "sync", "ingest"],
    subCategories: ["data-pipeline-etl"],
  },
  // 30. Notebook & Data Science
  {
    triggers: ["notebook", "jupyter", "khoa hoc du lieu", "data science"],
    synonyms: ["notebook", "jupyter", "data", "python", "analysis", "pandas"],
    subCategories: ["data-science-notebooks"],
  },
  // 31. Mật khẩu & Secrets
  {
    triggers: [
      "mat khau",
      "password",
      "vault",
      "secrets",
      "bitwarden",
      "2fa",
      "totp",
    ],
    synonyms: [
      "password",
      "mat khau",
      "vault",
      "secrets",
      "env",
      "2fa",
      "totp",
      "encryption",
    ],
    subCategories: ["security-vault"],
  },
  // 32. Bảo mật & Pentest
  {
    triggers: [
      "bao mat",
      "security",
      "lo hong",
      "pentest",
      "quet",
      "scanner",
      "vulnerability",
    ],
    synonyms: [
      "security",
      "bao mat",
      "vulnerability",
      "pentest",
      "scanner",
      "sast",
      "dast",
      "audit",
    ],
    subCategories: [
      "pentest-vuln-scanner",
      "firewall-siem-defense",
      "security-vault",
    ],
  },
  // 33. Tường lửa & Phòng thủ
  {
    triggers: ["tuong lua", "firewall", "waf", "siem", "ddos", "ids", "ips"],
    synonyms: [
      "firewall",
      "tuong lua",
      "waf",
      "siem",
      "ddos",
      "defense",
      "intrusion",
    ],
    subCategories: ["firewall-siem-defense"],
  },
  // 34. Quyền riêng tư & Mã hóa
  {
    triggers: [
      "quyen rieng tu",
      "privacy",
      "ma hoa",
      "an danh",
      "chan theo doi",
      "encryption",
    ],
    synonyms: [
      "privacy",
      "quyen rieng tu",
      "encryption",
      "ma hoa",
      "e2e",
      "anonymous",
      "adblock",
    ],
    subCategories: ["privacy-encryption-comms", "network-proxy-vpn"],
  },
  // 35. Proxy, VPN & DNS
  {
    triggers: ["proxy", "vpn", "dns", "wireguard", "tailscale", "mang", "network"],
    synonyms: [
      "proxy",
      "vpn",
      "dns",
      "wireguard",
      "tailscale",
      "network",
      "reverse proxy",
    ],
    subCategories: ["network-proxy-vpn"],
  },
  // 36. Deploy & Self-host
  {
    triggers: [
      "deploy",
      "trien khai",
      "self host",
      "selfhost",
      "paas",
      "vps",
      "vercel",
    ],
    synonyms: [
      "deploy",
      "trien khai",
      "self host",
      "paas",
      "vps",
      "docker",
      "hosting",
    ],
    subCategories: ["self-host-deploy", "containers-homelab"],
  },
  // 37. Docker, Kubernetes & Homelab
  {
    triggers: ["docker", "kubernetes", "k8s", "container", "homelab", "server"],
    synonyms: [
      "docker",
      "kubernetes",
      "k8s",
      "container",
      "homelab",
      "server",
      "dashboard",
    ],
    subCategories: ["containers-homelab", "self-host-deploy"],
  },
  // 38. Giám sát & Log
  {
    triggers: [
      "giam sat",
      "monitoring",
      "log",
      "logs",
      "uptime",
      "observability",
      "apm",
      "tracing",
    ],
    synonyms: [
      "monitoring",
      "giam sat",
      "log",
      "uptime",
      "observability",
      "metrics",
      "tracing",
      "alert",
    ],
    subCategories: ["testing-monitoring"],
  },
  // 39. Kiểm thử / Test
  {
    triggers: ["kiem thu", "test", "testing", "e2e", "benchmark"],
    synonyms: ["test", "testing", "kiem thu", "e2e", "unit", "mock", "assert"],
    subCategories: ["testing-monitoring", "api-client-testing"],
  },
  // 40. Ghi chú & PKM
  {
    triggers: [
      "ghi chu",
      "note",
      "notes",
      "pkm",
      "second brain",
      "wiki",
      "markdown",
      "hoc tap",
      "flashcard",
    ],
    synonyms: [
      "note",
      "notes",
      "ghi chu",
      "markdown",
      "wiki",
      "knowledge",
      "pkm",
      "notion",
      "obsidian",
    ],
    subCategories: ["pkm-study-notes"],
  },
  // 41. Quản lý công việc & Lịch
  {
    triggers: [
      "quan ly cong viec",
      "cong viec",
      "du an",
      "kanban",
      "todo",
      "task",
      "lich",
      "calendar",
    ],
    synonyms: [
      "task",
      "project",
      "kanban",
      "issue",
      "todo",
      "calendar",
      "lich",
      "jira",
      "linear",
    ],
    subCategories: ["task-project-management"],
  },
  // 42. RSS & Bookmark
  {
    triggers: ["rss", "doc tin", "bookmark", "bookmarks", "feed", "read later"],
    synonyms: ["rss", "feed", "bookmark", "read", "reader", "news", "archive"],
    subCategories: ["rss-bookmarks-reading"],
  },
  // 43. PDF & Chuyển đổi tài liệu
  {
    triggers: ["pdf", "chuyen doi", "convert", "converter", "tai lieu", "slide"],
    synonyms: [
      "pdf",
      "convert",
      "converter",
      "chuyen doi",
      "document",
      "tai lieu",
      "markdown",
      "office",
    ],
    subCategories: ["document-converter", "rag-ocr-extract"],
  },
  // 44. Thiết kế & Vẽ sơ đồ
  {
    triggers: ["thiet ke", "design", "ve so do", "diagram", "whiteboard", "ui", "icon"],
    synonyms: [
      "design",
      "thiet ke",
      "diagram",
      "so do",
      "whiteboard",
      "ui",
      "icon",
      "component",
      "figma",
    ],
    subCategories: ["ui-components-viz", "image-svg-tools", "team-chat-collab"],
  },
  // 45. Chia sẻ file & Sao lưu
  {
    triggers: [
      "chia se file",
      "truyen file",
      "gui file",
      "file",
      "sao luu",
      "backup",
    ],
    synonyms: [
      "file",
      "share",
      "sync",
      "transfer",
      "backup",
      "sao luu",
      "storage",
      "cloud",
    ],
    subCategories: ["file-sync-share"],
  },
  // 46. CLI & Terminal & Git
  {
    triggers: ["cli", "terminal", "shell", "dong lenh", "git", "dotfiles"],
    synonyms: ["cli", "terminal", "shell", "git", "command", "tui", "console"],
    subCategories: ["cli-dev-env"],
  },
  // 47. Web Framework & Runtime
  {
    triggers: ["framework", "runtime", "bundler", "nextjs", "react", "backend", "frontend"],
    synonyms: [
      "framework",
      "runtime",
      "bundler",
      "web",
      "server",
      "fullstack",
      "sdk",
    ],
    subCategories: ["web-frameworks-runtime"],
  },
  // 48. Linter & Code Quality
  {
    triggers: ["linter", "formatter", "lint", "static analysis", "monorepo"],
    synonyms: ["lint", "linter", "formatter", "quality", "analysis", "docs"],
    subCategories: ["code-quality-docs"],
  },
  // 49. Tiện ích Desktop & Hệ điều hành
  {
    triggers: [
      "desktop",
      "he dieu hanh",
      "windows",
      "macos",
      "linux",
      "launcher",
      "clipboard",
      "tien ich",
    ],
    synonyms: [
      "desktop",
      "os",
      "window",
      "clipboard",
      "launcher",
      "utility",
      "tien ich",
    ],
    subCategories: ["os-desktop-utility"],
  },
  // 50. CMS, Blog & Thương mại điện tử
  {
    triggers: ["cms", "blog", "thuong mai dien tu", "ecommerce", "shop", "store"],
    synonyms: [
      "cms",
      "blog",
      "ecommerce",
      "shop",
      "storefront",
      "headless",
      "static",
    ],
    subCategories: ["cms-blog-ecommerce"],
  },
  // 51. Cộng tác nhóm & Họp video
  {
    triggers: ["cong tac", "team", "hop video", "video call", "meeting"],
    synonyms: ["team", "collab", "chat", "meeting", "video", "whiteboard"],
    subCategories: ["team-chat-collab"],
  },
  // 52. CRM, ERP & Tài chính / Kế toán
  {
    triggers: [
      "crm",
      "erp",
      "tai chinh",
      "ke toan",
      "hoa don",
      "invoice",
      "finance",
    ],
    synonyms: [
      "crm",
      "erp",
      "finance",
      "accounting",
      "invoice",
      "tai chinh",
      "ke toan",
      "khach hang",
    ],
    subCategories: ["crm-erp-finance"],
  },
] as const;

export const TRIGGER_LOOKUP = new Map<string, readonly SynonymConceptEntry[]>();
for (const entry of SYNONYM_CONCEPT_ENTRIES) {
  for (const trigger of entry.triggers) {
    const existing = TRIGGER_LOOKUP.get(trigger) ?? [];
    TRIGGER_LOOKUP.set(trigger, [...existing, entry]);
  }
}
