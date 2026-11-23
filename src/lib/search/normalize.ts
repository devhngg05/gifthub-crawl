export const POPULAR_SEARCH_SUGGESTIONS = [
  "nối API",
  "chạy AI local",
  "cào web",
  "ghi chú",
  "quản lý mật khẩu",
] as const;

export const MULTIWORD_SOFT_STOPWORDS = [
  "ma nguon mo",
  "open source",
  "cong cu",
  "phan mem",
  "ung dung",
  "tot nhat",
  "mien phi",
  "dung de",
  "ho tro",
  "cho phep",
] as const;

export const SINGLE_SOFT_STOPWORDS = new Set<string>([
  "app",
  "apps",
  "tool",
  "tools",
  "software",
  "chay",
  "dung",
  "giup",
  "cho",
  "cua",
  "va",
  "voi",
  "cac",
  "mot",
  "la",
  "de",
  "hay",
  "free",
  "best",
  "opensource",
]);

/**
 * Chuẩn hóa văn bản tìm kiếm:
 * đổi `đ/Đ -> d`, bỏ dấu tiếng Việt (NFD), chuyển chữ thường, đổi ký tự đặc biệt thành khoảng trắng và gom gọn.
 */
export function normalizeSearchText(input: string): string {
  return input
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Loại bỏ các cụm stopword nhiều từ đã chuẩn hóa, trả về bản gốc nếu rỗng sau khi lọc. */
export function stripMultiwordSoftStopwords(normalized: string): string {
  let current = ` ${normalized} `;
  for (const phrase of MULTIWORD_SOFT_STOPWORDS) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    current = current.replace(new RegExp(`\\s${escaped}(?=\\s)`, "g"), " ");
  }
  const stripped = current.trim().replace(/\s+/g, " ");
  return stripped.length > 0 ? stripped : normalized;
}
