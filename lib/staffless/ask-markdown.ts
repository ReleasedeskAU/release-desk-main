/**
 * Lightweight GFM subset for Ask answers: tables, lists, headings, fences, inline.
 * HTML from the model is kept as text (React nodes) — never interpreted as markup.
 */

import { safeHttpUrl } from "@/lib/staffless/ask-packets";

/** Rows shown before “Show all” on large Ask tables. */
export const ASK_TABLE_PREVIEW_ROWS = 12;

export type AskMdInline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

/** One list row. Nested bullets stay under this row so numbering can continue. */
export type AskMdListItem = {
  text: string;
  nested: string[];
};

export type AskMdBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: AskMdListItem[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "code"; text: string };

/**
 * Split Ask assistant markdown into typed blocks.
 * Incomplete tables (header without a separator yet) stay paragraphs so streaming
 * does not flash a broken table.
 */
export function parseAskMarkdown(text: string): AskMdBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: AskMdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i]?.trim()) {
      i += 1;
      continue;
    }
    const fence = readFence(lines, i);
    if (fence) {
      blocks.push(fence.block);
      i = fence.next;
      continue;
    }
    const table = readTable(lines, i);
    if (table) {
      blocks.push(table.block);
      i = table.next;
      continue;
    }
    const heading = readHeading(lines[i] ?? "");
    if (heading) {
      blocks.push(heading);
      i += 1;
      continue;
    }
    const list = readList(lines, i);
    if (list) {
      blocks.push(list.block);
      i = list.next;
      continue;
    }
    const para = readParagraph(lines, i);
    blocks.push(para.block);
    i = para.next;
  }
  return blocks;
}

/**
 * Inline **bold**, `code`, and [label](https://…) runs.
 * Non-http(s) link targets are kept as plain text (XSS: no javascript: URLs).
 */
export function parseAskInline(line: string): AskMdInline[] {
  const out: AskMdInline[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match = re.exec(line);
  while (match) {
    if (match.index > last) out.push({ type: "text", text: line.slice(last, match.index) });
    out.push(inlineToken(match[0]));
    last = match.index + match[0].length;
    match = re.exec(line);
  }
  if (last < line.length) out.push({ type: "text", text: line.slice(last) });
  return out.length > 0 ? out : [{ type: "text", text: line }];
}

function inlineToken(token: string): AskMdInline {
  if (token.startsWith("**") && token.endsWith("**")) {
    return { type: "bold", text: token.slice(2, -2) };
  }
  if (token.startsWith("__") && token.endsWith("__")) {
    return { type: "bold", text: token.slice(2, -2) };
  }
  if (token.startsWith("`") && token.endsWith("`")) {
    return { type: "code", text: token.slice(1, -1) };
  }
  const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (link) {
    const href = safeHttpUrl(link[2]);
    if (href) return { type: "link", text: link[1], href };
  }
  return { type: "text", text: token };
}

function readFence(
  lines: string[],
  start: number
): { block: AskMdBlock; next: number } | null {
  const open = lines[start] ?? "";
  if (!open.trimStart().startsWith("```")) return null;
  const body: string[] = [];
  let i = start + 1;
  while (i < lines.length && !lines[i]?.trimStart().startsWith("```")) {
    body.push(lines[i] ?? "");
    i += 1;
  }
  return { block: { type: "code", text: body.join("\n") }, next: i < lines.length ? i + 1 : i };
}

function readHeading(line: string): AskMdBlock | null {
  const m = line.match(/^(#{2,3})\s+(.+)$/);
  if (!m) return null;
  return { type: "heading", level: m[1].length === 2 ? 2 : 3, text: m[2].trim() };
}

const NUMBERED_ITEM = /^\s*\d+\.\s+(.+)$/;
const BULLET_ITEM = /^\s*[-*•]\s+(.+)$/;

function numberedText(line: string): string | null {
  const match = line.match(NUMBERED_ITEM);
  return match ? (match[1] ?? "") : null;
}

function bulletText(line: string): string | null {
  const match = line.match(BULLET_ITEM);
  return match ? (match[1] ?? "") : null;
}

function nextNonEmptyLine(lines: string[], from: number): string {
  let i = from;
  while (i < lines.length && !(lines[i] ?? "").trim()) i += 1;
  return lines[i] ?? "";
}

function readList(
  lines: string[],
  start: number
): { block: AskMdBlock; next: number } | null {
  const first = lines[start] ?? "";
  if (numberedText(first) != null) return readOrderedList(lines, start);
  if (bulletText(first) != null) return readBulletList(lines, start);
  return null;
}

/**
 * Consecutive bullets only. Blank lines end the list (same as before).
 */
function readBulletList(
  lines: string[],
  start: number
): { block: AskMdBlock; next: number } {
  const items: AskMdListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const text = bulletText(lines[i] ?? "");
    if (text == null) break;
    items.push({ text, nested: [] });
    i += 1;
  }
  return { block: { type: "list", ordered: false, items }, next: i };
}

/**
 * Numbered rows stay one list even when the model writes `1.` each time
 * and puts field bullets (or blank lines) between records.
 */
function readOrderedList(
  lines: string[],
  start: number
): { block: AskMdBlock; next: number } {
  const items: AskMdListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      const peek = nextNonEmptyLine(lines, i + 1);
      if (numberedText(peek) != null || (items.length > 0 && bulletText(peek) != null)) {
        i += 1;
        continue;
      }
      break;
    }
    const numbered = numberedText(line);
    if (numbered != null) {
      items.push({ text: numbered, nested: [] });
      i += 1;
      continue;
    }
    const bullet = bulletText(line);
    if (bullet != null && items.length > 0) {
      items[items.length - 1]?.nested.push(bullet);
      i += 1;
      continue;
    }
    break;
  }
  return { block: { type: "list", ordered: true, items }, next: i };
}

function readParagraph(
  lines: string[],
  start: number
): { block: AskMdBlock; next: number } {
  const buf: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) break;
    if (line.trimStart().startsWith("```")) break;
    if (readHeading(line) || lookLikeListLine(line) || lookLikeTableStart(lines, i)) break;
    buf.push(line.trimEnd());
    i += 1;
  }
  return { block: { type: "paragraph", text: buf.join("\n") }, next: i };
}

function lookLikeListLine(line: string): boolean {
  return /^\s*[-*•]\s+/.test(line) || /^\s*\d+\.\s+/.test(line);
}

function lookLikeTableStart(lines: string[], i: number): boolean {
  return readTable(lines, i) !== null;
}

function readTable(
  lines: string[],
  start: number
): { block: Extract<AskMdBlock, { type: "table" }>; next: number } | null {
  const headerLine = lines[start] ?? "";
  const sepLine = lines[start + 1] ?? "";
  if (!headerLine.includes("|") || !isSeparatorRow(sepLine)) return null;
  const headers = splitTableRow(headerLine);
  if (headers.length === 0) return null;
  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim() || !line.includes("|") || isSeparatorRow(line)) break;
    rows.push(padRow(splitTableRow(line), headers.length));
    i += 1;
  }
  return { block: { type: "table", headers, rows }, next: i };
}

function isSeparatorRow(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function splitTableRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return body.split("|").map((c) => c.trim());
}

function padRow(cells: string[], width: number): string[] {
  const next = cells.slice(0, width);
  while (next.length < width) next.push("");
  return next;
}
