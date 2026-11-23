export const MAX_README_LENGTH = 2500;

const LANGUAGE_SWITCHER_TOKEN_PATTERN =
  /^(?:english|中文|简体中文|繁體中文|日本語|한국어|français|español|deutsch|português|русский|italiano|tiếng việt|türkçe|polski|nederlands|українська|indonesia|العربية|हिन्दी|readme(?:\.[a-z-]+)?)$/i;

function isMultiLanguageSwitcherLine(line: string): boolean {
  if (!line.includes("|")) {
    return false;
  }

  const segments = line
    .split("|")
    .map((segment) =>
      segment
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[^\p{L}\p{N}\s.-]/gu, "")
        .trim(),
    )
    .filter(Boolean);

  if (segments.length < 3) {
    return false;
  }

  const languageMatches = segments.filter(
    (segment) =>
      LANGUAGE_SWITCHER_TOKEN_PATTERN.test(segment) ||
      /readme[._-][a-z]{2}/i.test(line),
  ).length;

  return languageMatches >= 2;
}

function stripNoiseLines(rawText: string): string {
  const lines = rawText.split(/\r?\n/);
  const keptLines: string[] = [];
  let inTocBlock = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (isMultiLanguageSwitcherLine(trimmed)) {
      continue;
    }

    const isTocHeading =
      /^#{1,6}\s*(?:table of contents|contents|toc|mục lục)\s*$/i.test(
        trimmed,
      ) ||
      /^\*{2}(?:table of contents|contents|mục lục)\*{2}\s*$/i.test(trimmed);

    if (isTocHeading) {
      inTocBlock = true;
      continue;
    }

    if (inTocBlock) {
      if (trimmed === "") {
        continue;
      }
      const isTocEntry =
        /^(?:[-*+]|\d+\.)\s+\[[^\]]+\]\(#[^)]+\)/.test(trimmed) ||
        /^\[[^\]]+\]\(#[^)]+\)\s*(?:·|\||•)?$/.test(trimmed);
      if (isTocEntry) {
        continue;
      }
      inTocBlock = false;
    }

    keptLines.push(trimmed);
  }

  return keptLines.join("\n");
}

function extractPrioritizedReadmeContent(structuredText: string): string {
  const lines = structuredText.split(/\n+/);
  const sections: Array<{ heading: string; content: string }> = [];
  let currentHeading = "__intro__";
  let currentBuffer: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (headingMatch) {
      const joined = currentBuffer.join(" ").replace(/\s+/g, " ").trim();
      if (joined) {
        sections.push({ heading: currentHeading, content: joined });
      }
      currentHeading = headingMatch[1].trim();
      currentBuffer = [line];
    } else if (line.trim()) {
      currentBuffer.push(line.trim());
    }
  }

  const tailJoined = currentBuffer.join(" ").replace(/\s+/g, " ").trim();
  if (tailJoined) {
    sections.push({ heading: currentHeading, content: tailJoined });
  }

  if (sections.length <= 1) {
    return structuredText.replace(/\s+/g, " ").trim().slice(0, MAX_README_LENGTH);
  }

  const pickedIndices = new Set<number>();
  const parts: string[] = [];

  const appendSection = (idx: number, budget: number) => {
    if (pickedIndices.has(idx) || idx < 0 || idx >= sections.length) {
      return;
    }
    pickedIndices.add(idx);
    const slice = sections[idx].content.slice(0, budget).trim();
    if (slice) {
      parts.push(slice);
    }
  };

  // 1. Intro / Title section
  appendSection(0, 1000);
  if (sections.length > 1 && sections[0].content.length < 220) {
    appendSection(1, 600);
  }

  // 2. Features / Overview / Highlights
  const featureIdx = sections.findIndex(
    (s, idx) =>
      !pickedIndices.has(idx) &&
      /\b(?:features?|highlights?|capabilities|overview|what(?:'s| is)\b|why\b|about|tính năng|giới thiệu)\b/i.test(
        s.heading,
      ),
  );
  if (featureIdx !== -1) {
    appendSection(featureIdx, 850);
  }

  // 3. Installation / Quick Start / Usage / Docker
  const installIdx = sections.findIndex(
    (s, idx) =>
      !pickedIndices.has(idx) &&
      /\b(?:install(?:ation)?|getting started|quick\s*start|usage|docker|deploy(?:ment)?|self-?host(?:ing)?|setup|cli|cài đặt|sử dụng)\b/i.test(
        s.heading,
      ),
  );
  if (installIdx !== -1) {
    appendSection(installIdx, 700);
  }

  // Fill remaining budget in natural order so useful content is never wasted
  let combined = parts.join(" ");
  for (
    let i = 0;
    i < sections.length && combined.length < MAX_README_LENGTH;
    i += 1
  ) {
    if (pickedIndices.has(i)) {
      continue;
    }
    const remaining = MAX_README_LENGTH - combined.length - 1;
    if (remaining <= 0) {
      break;
    }
    const extra = sections[i].content.slice(0, remaining).trim();
    if (extra) {
      combined = combined ? `${combined} ${extra}` : extra;
    }
  }

  return combined.replace(/\s+/g, " ").trim().slice(0, MAX_README_LENGTH);
}

/**
 * Làm sạch nội dung README thông minh:
 * xóa comment HTML, SVG/picture/media/script/style, badges, ảnh Markdown, thanh chuyển ngôn ngữ,
 * mục lục (Table of Contents), và ưu tiên giữ phần Intro + Features + Installation/Usage trước khi cắt tại 2.500 ký tự.
 */
export function cleanReadmeText(rawMarkdown: string): string {
  const withoutMarkup = rawMarkdown
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(
      /<(script|style|svg|picture|video|audio)\b[^>]*>[\s\S]*?<\/\1>/gi,
      "\n",
    )
    .replace(
      /\[!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])\](?:\([^)]*\)|\[[^\]]*\])/g,
      " ",
    )
    .replace(/!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])/g, " ")
    .replace(
      /^\s*\[[^\]]+\]:\s*https?:\/\/(?:img\.shields\.io|badgen\.net|badge\.fury\.io|codecov\.io|github\.com\/[^\s]*badge\.svg)[^\r\n]*$/gim,
      "",
    )
    .replace(/<[^>]+>/g, " ");

  const withoutNoiseLines = stripNoiseLines(withoutMarkup);
  const collapsed = withoutNoiseLines.replace(/\s+/g, " ").trim();

  if (collapsed.length <= MAX_README_LENGTH) {
    return collapsed;
  }

  return extractPrioritizedReadmeContent(withoutNoiseLines);
}
