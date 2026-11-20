export type ReleaseNoteInline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; label: string; url: string };

export type ReleaseNoteBlock =
  | { kind: "heading"; level: 1 | 2 | 3; inlines: ReleaseNoteInline[] }
  | { kind: "list"; items: ReleaseNoteInline[][] }
  | { kind: "paragraph"; inlines: ReleaseNoteInline[] };

const INLINE_TOKEN_RE = /`([^`]+)`|\[([^\]]+)\]\(((?:[^()\s]+|\([^()\s]*\))+)\)|\*\*([^*]+)\*\*/g;
const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const LIST_ITEM_RE = /^[-*•]\s+(.+)$/;

function isSafeExternalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function parseReleaseNoteInlines(text: string): ReleaseNoteInline[] {
  const tokens: ReleaseNoteInline[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      tokens.push({ kind: "text", text: text.slice(cursor, index) });
    }

    const [, codeText, linkLabel, linkUrl, boldText] = match;
    if (codeText !== undefined) {
      tokens.push({ kind: "code", text: codeText });
    } else if (linkLabel !== undefined && linkUrl !== undefined) {
      if (isSafeExternalHttpUrl(linkUrl)) {
        tokens.push({ kind: "link", label: linkLabel, url: linkUrl });
      } else {
        tokens.push({ kind: "text", text: linkLabel });
      }
    } else if (boldText !== undefined) {
      tokens.push({ kind: "strong", text: boldText });
    }

    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    tokens.push({ kind: "text", text: text.slice(cursor) });
  }

  return tokens.length > 0 ? tokens : [{ kind: "text", text }];
}

/** 将常见 GitHub Release Notes Markdown 拆分为标题、列表和段落。 */
export function parseReleaseNotes(markdown: string): ReleaseNoteBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReleaseNoteBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: ReleaseNoteInline[][] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join(" ").trim();
    paragraphLines = [];
    if (text) {
      blocks.push({ kind: "paragraph", inlines: parseReleaseNoteInlines(text) });
    }
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push({ kind: "list", items: listItems });
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(3, headingMatch[1].length) as 1 | 2 | 3;
      blocks.push({
        kind: "heading",
        level,
        inlines: parseReleaseNoteInlines(headingMatch[2].trim()),
      });
      continue;
    }

    const listMatch = line.match(LIST_ITEM_RE);
    if (listMatch) {
      flushParagraph();
      listItems.push(parseReleaseNoteInlines(listMatch[1].trim()));
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}
