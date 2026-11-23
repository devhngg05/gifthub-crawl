const SECRET_PLACEHOLDER_DB = "[REDACTED_DATABASE_URL]";
const SECRET_PLACEHOLDER_TOKEN = "[REDACTED_TOKEN]";

/**
 * Che thông tin nhạy cảm (connection string PostgreSQL, Bearer token, API key)
 * và chuẩn hóa khoảng trắng trước khi ghi log hoặc lưu DB.
 */
export function redactSecrets(
  raw: string,
  extraSecrets: readonly (string | undefined)[] = [],
): string {
  let sanitized = raw;

  for (const secret of extraSecrets) {
    const trimmed = secret?.trim();
    if (trimmed && trimmed.length > 0) {
      sanitized = sanitized.split(trimmed).join(SECRET_PLACEHOLDER_TOKEN);
    }
  }

  return sanitized
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, SECRET_PLACEHOLDER_DB)
    .replace(/Bearer\s+[^\s"'`]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:gsk|ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_-]+/g,
      SECRET_PLACEHOLDER_TOKEN,
    )
    .replace(/\bgithub_pat_[A-Za-z0-9_]+/g, SECRET_PLACEHOLDER_TOKEN)
    .replace(/\bsk-or-[A-Za-z0-9_-]+/g, SECRET_PLACEHOLDER_TOKEN)
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, SECRET_PLACEHOLDER_TOKEN)
    .replace(/\s+/g, " ")
    .trim();
}

/** Làm sạch thông điệp lỗi bất kỳ trước khi log hoặc lưu vào `sync_logs`. */
export function sanitizeErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);

  const redacted = redactSecrets(raw);
  return redacted.length > 0 ? redacted : "Unknown error";
}

/** Rút gọn và làm sạch body lỗi HTTP/response trước khi log (tối đa 200 ký tự). */
export function sanitizeResponseSnippet(
  rawText: string,
  apiKey?: string,
  maxLength = 200,
): string {
  const sanitized = redactSecrets(rawText, [apiKey]);

  if (sanitized.length <= maxLength) {
    return sanitized;
  }

  if (maxLength <= 3) {
    return sanitized.slice(0, maxLength);
  }

  return `${sanitized.slice(0, maxLength - 3)}...`;
}
