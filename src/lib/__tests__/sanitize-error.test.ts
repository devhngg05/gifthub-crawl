import { describe, expect, it } from "vitest";
import {
  redactSecrets,
  sanitizeErrorMessage,
  sanitizeResponseSnippet,
} from "@/lib/sanitize-error";

describe("sanitize-error helpers", () => {
  it("che URL PostgreSQL, Bearer token và các định dạng API token phổ biến", () => {
    const raw =
      "Failed postgres://admin:supersecret@ep-demo.neon.tech/neondb?sslmode=require with Bearer my-jwt-token gsk_abc123 ghp_xyz789 github_pat_11AA22 sk-or-v1-999 AIzaSyDemoGeminiApiKey1234567890abcdef";

    const redacted = redactSecrets(raw);

    expect(redacted).not.toContain("supersecret");
    expect(redacted).not.toContain("my-jwt-token");
    expect(redacted).not.toContain("gsk_abc123");
    expect(redacted).not.toContain("ghp_xyz789");
    expect(redacted).not.toContain("github_pat_11AA22");
    expect(redacted).not.toContain("sk-or-v1-999");
    expect(redacted).not.toContain("AIzaSyDemoGeminiApiKey1234567890abcdef");
    expect(redacted).toContain("[REDACTED_DATABASE_URL]");
    expect(redacted).toContain("Bearer [REDACTED]");
    expect(redacted).toContain("[REDACTED_TOKEN]");
  });

  it("che extraSecrets truyền vào và xử lý sanitizeErrorMessage với Error hoặc chuỗi rỗng", () => {
    expect(
      redactSecrets("API error using custom-secret-key-42", [
        "custom-secret-key-42",
      ]),
    ).toBe("API error using [REDACTED_TOKEN]");

    expect(
      sanitizeErrorMessage(
        new Error("DB error postgresql://u:p@host/db\n  retry later"),
      ),
    ).toBe("DB error [REDACTED_DATABASE_URL] retry later");

    expect(sanitizeErrorMessage("   ")).toBe("Unknown error");
  });

  it("rút gọn body response theo maxLength và che apiKey", () => {
    const longBody = `Error with my-key-123: ${"A".repeat(250)}`;
    const snippet = sanitizeResponseSnippet(longBody, "my-key-123", 50);

    expect(snippet.length).toBe(50);
    expect(snippet).toContain("[REDACTED_TOKEN]");
    expect(snippet.endsWith("...")).toBe(true);

    expect(sanitizeResponseSnippet("abcdef", undefined, 3)).toBe("abc");
  });
});
