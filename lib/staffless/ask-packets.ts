/**
 * Map StaffLess chat NDJSON packets onto a small Ask event vocabulary.
 * Upstream error strings are dropped — they can leak internals.
 */

import { ASK_ADDITIONAL_CONTEXT, ASK_PUBLIC_UNAVAILABLE } from "@/lib/staffless/ask-copy";
import type { AskGrounding } from "@/lib/staffless/ask-grounding";
import { ASK_TOOL_LIST_MATCHING, ASK_TOOL_DOCUMENT_BY_KEY, ASK_TOOL_SEARCH_INDEX } from "@/lib/staffless/ask-tools";

/** Live StaffLess chat endpoints (nginx `/api` prefix). */
export const STAFFLESS_CREATE_SESSION_PATH = "/api/chat/create-chat-session";
export const STAFFLESS_SEND_CHAT_PATH = "/api/chat/send-chat-message";

export type AskSource = {
  id: string;
  title: string;
  url: string | null;
  source: string;
  citationNumber?: number;
};

export type AskEvent =
  | { type: "session"; sessionId: string }
  | { type: "status"; phase: "searching" | "answering" }
  | { type: "text"; text: string }
  | { type: "grounding"; kind: AskGrounding }
  | { type: "sources"; sources: AskSource[] }
  | { type: "citation"; n: number; documentId: string }
  | { type: "error"; message: string }
  | { type: "done" };

const PUBLIC_STREAM_ERROR = ASK_PUBLIC_UNAVAILABLE;

/** AUTO_PLACE_AFTER_LATEST_MESSAGE in StaffLess SendMessageRequest. */
const PARENT_AFTER_LATEST = -1;

/**
 * Body for POST /api/chat/send-chat-message.
 * Omits retrieval_options.real_time (rejected by current StaffLess).
 * @param message - User question (already validated).
 * @param sessionId - StaffLess chat session UUID.
 * @param additionalContext - Injected instructions; defaults to ASK_ADDITIONAL_CONTEXT.
 */
export function buildSendChatMessageBody(
  message: string,
  sessionId: string,
  additionalContext: string = ASK_ADDITIONAL_CONTEXT
): Record<string, unknown> {
  return {
    message,
    chat_session_id: sessionId,
    parent_message_id: PARENT_AFTER_LATEST,
    stream: true,
    // Citations are stripped so Ask shows the answer only — no [1]/Sources chips.
    include_citations: false,
    deep_research: false,
    additional_context: additionalContext,
  };
}

/**
 * Parse one StaffLess NDJSON line into zero or more Ask events.
 * Malformed lines are skipped so a partial stream still finishes.
 */
export function mapStafflessLineToAskEvents(line: string): AskEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  return mapStafflessPacket(parsed);
}

/**
 * Convert a parsed StaffLess packet (or error object) into Ask events.
 * Never forwards upstream exception text to the browser.
 */
export function mapStafflessPacket(raw: unknown): AskEvent[] {
  if (!raw || typeof raw !== "object") return [];
  const rec = raw as Record<string, unknown>;
  // StaffLess yields {"error": "..."} on uncaught stream failures.
  if (typeof rec.error === "string") return [{ type: "error", message: PUBLIC_STREAM_ERROR }];
  const obj =
    rec.obj && typeof rec.obj === "object"
      ? (rec.obj as Record<string, unknown>)
      : rec;
  return mapPacketObj(obj);
}

function mapPacketObj(obj: Record<string, unknown>): AskEvent[] {
  const type = typeof obj.type === "string" ? obj.type : "";
  if (type === "search_tool_start") return [{ type: "status", phase: "searching" }];
  if (type === "message_start") return mapMessageStart(obj);
  if (type === "message_delta" && typeof obj.content === "string" && obj.content) {
    return [{ type: "text", text: obj.content }];
  }
  if (type === "search_tool_documents_delta" || type === "open_url_documents") {
    return [{ type: "sources", sources: mapDocs(obj.documents) }];
  }
  if (type === "citation_info") return mapCitation(obj);
  if (type === "error") return [{ type: "error", message: PUBLIC_STREAM_ERROR }];
  return [];
}

function mapMessageStart(obj: Record<string, unknown>): AskEvent[] {
  const events: AskEvent[] = [{ type: "status", phase: "answering" }];
  const docs = mapDocs(obj.final_documents);
  if (docs.length > 0) events.push({ type: "sources", sources: docs });
  return events;
}

function mapCitation(obj: Record<string, unknown>): AskEvent[] {
  const n = typeof obj.citation_number === "number" ? obj.citation_number : null;
  const documentId = typeof obj.document_id === "string" ? obj.document_id : "";
  if (n == null || !documentId) return [];
  return [{ type: "citation", n, documentId }];
}

function mapDocs(value: unknown): AskSource[] {
  if (!Array.isArray(value)) return [];
  const out: AskSource[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const source = mapDoc(item);
    if (!source || seen.has(source.id)) continue;
    seen.add(source.id);
    out.push(source);
  }
  return out;
}

function mapDoc(item: unknown): AskSource | null {
  if (!item || typeof item !== "object") return null;
  const doc = item as Record<string, unknown>;
  const id =
    (typeof doc.document_id === "string" && doc.document_id) ||
    (typeof doc.semantic_identifier === "string" && doc.semantic_identifier) ||
    "";
  if (!id) return null;
  const source = sourceLabel(typeof doc.source_type === "string" ? doc.source_type : "");
  const title = askSourceDisplayTitle(
    typeof doc.semantic_identifier === "string" ? doc.semantic_identifier : "",
    "",
    source
  );
  return { id, title, url: safeHttpUrl(doc.link), source };
}

/**
 * Only http(s) links are shown — connector ids and javascript: URLs stay hidden.
 */
export function safeHttpUrl(link: unknown): string | null {
  if (typeof link !== "string") return null;
  const trimmed = link.trim();
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) return trimmed;
  return null;
}

function sourceLabel(sourceType: string): string {
  const lower = sourceType.toLowerCase();
  if (lower === "jira") return "Jira";
  if (lower === "github") return "GitHub";
  if (lower === "bitbucket") return "Bitbucket";
  if (lower === "teams") return "Microsoft Teams";
  if (lower === "imap") return "Email (IMAP)";
  if (lower === "slack") return "Slack";
  if (!sourceType) return "Indexed";
  return sourceType.replace(/_/g, " ");
}

const GENERIC_TITLE = /^(about\s+)?unknown subject$/i;

/** Max source chips shown under an Ask answer. */
export const ASK_SOURCE_CHIP_CAP = 3;

/**
 * Chip title from stored fields. Empty or "Unknown Subject" is not shown as-is.
 * @param title - Indexed title when present.
 * @param key - Stored document key when present.
 * @param source - Display source label.
 */
export function askSourceDisplayTitle(title: string, key: string, source: string): string {
  const trimmedTitle = title.trim();
  const trimmedKey = key.trim();
  const trimmedSource = source.trim();
  if (trimmedTitle && !GENERIC_TITLE.test(trimmedTitle)) return trimmedTitle;
  if (trimmedSource && trimmedKey) return `${trimmedSource} · ${trimmedKey}`;
  if (trimmedKey) return trimmedKey;
  if (/teams/i.test(trimmedSource)) return "Teams conversation";
  return trimmedSource || "Indexed";
}

function sourceFromToolDoc(item: unknown): AskSource | null {
  if (!item || typeof item !== "object") return null;
  const doc = item as Record<string, unknown>;
  const url = safeHttpUrl(doc.link);
  if (!url) return null;
  // Permalink/browse URL is the record identity. Slack catalog keys are often the
  // shared channel label ("Unknown in #social"), which is not unique per message.
  const sourceRaw =
    (typeof doc.source === "string" && doc.source) ||
    (typeof doc.source_type === "string" && doc.source_type) ||
    "";
  const source = sourceLabel(sourceRaw);
  const key = typeof doc.key === "string" ? doc.key : "";
  const rawTitle = typeof doc.title === "string" ? doc.title : "";
  return { id: url, title: askSourceDisplayTitle(rawTitle, key, source), url, source };
}

/**
 * Pull clickable record URLs out of an Ask tool JSON result.
 * Only http(s) links are kept — no invented permalinks.
 */
export function sourcesFromAskToolResult(raw: string): AskSource[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const rec = parsed as Record<string, unknown>;
  const out: AskSource[] = [];
  const seen = new Set<string>();
  const push = (source: AskSource | null) => {
    if (!source || seen.has(source.url ?? source.id)) return;
    seen.add(source.url ?? source.id);
    out.push(source);
  };
  if (Array.isArray(rec.documents)) {
    for (const item of rec.documents) push(sourceFromToolDoc(item));
  }
  if (rec.found === true) push(sourceFromToolDoc(rec));
  return out;
}

/**
 * Source chips for the answer. Ranked search is a neighbor sample — those URLs
 * are not evidence the asked-for ticket is related, so they stay off the chips.
 */
export function sourcesToAttachFromTool(toolName: string, raw: string): AskSource[] {
  if (toolName === ASK_TOOL_SEARCH_INDEX) return [];
  return sourcesFromAskToolResult(raw);
}

export type AskSourceBatch = { tool: string; sources: AskSource[] };

/**
 * Cap chips at 3. Prefer URLs cited in the answer; else the latest catalog list's first rows.
 * @param text - Final assistant markdown.
 * @param batches - Sources collected per tool call, in call order.
 */
export function selectAskSourceChips(text: string, batches: readonly AskSourceBatch[]): AskSource[] {
  const cited = citedSourcesFromText(text, batches);
  if (cited.length > 0) return cited.slice(0, ASK_SOURCE_CHIP_CAP);
  const listed = lastBatchSources(batches, ASK_TOOL_LIST_MATCHING);
  if (listed.length > 0) return listed.slice(0, ASK_SOURCE_CHIP_CAP);
  return lastBatchSources(batches, ASK_TOOL_DOCUMENT_BY_KEY).slice(0, ASK_SOURCE_CHIP_CAP);
}

function citedSourcesFromText(text: string, batches: readonly AskSourceBatch[]): AskSource[] {
  const byUrl = new Map<string, AskSource>();
  for (const batch of batches) {
    for (const source of batch.sources) {
      if (source.url) byUrl.set(source.url, source);
    }
  }
  const out: AskSource[] = [];
  const seen = new Set<string>();
  for (const url of urlsInMarkdown(text)) {
    const source = byUrl.get(url);
    if (!source || seen.has(url)) continue;
    seen.add(url);
    out.push(source);
  }
  return out;
}

function lastBatchSources(batches: readonly AskSourceBatch[], tool: string): AskSource[] {
  for (let i = batches.length - 1; i >= 0; i -= 1) {
    const batch = batches[i];
    if (batch && batch.tool === tool && batch.sources.length > 0) return batch.sources;
  }
  return [];
}

function urlsInMarkdown(text: string): string[] {
  const out: string[] = [];
  const re = /https?:\/\/[^\s)\]>"']+/gi;
  let match: RegExpExecArray | null = re.exec(text);
  while (match) {
    out.push(match[0].replace(/[.,;]+$/, ""));
    match = re.exec(text);
  }
  return out;
}

/**
 * Append newly retrieved sources without duplicating the same record URL.
 */
export function mergeAskSources(existing: AskSource[], incoming: AskSource[]): AskSource[] {
  const out = [...existing];
  const seen = new Set(existing.map((source) => source.url ?? source.id));
  for (const source of incoming) {
    const key = source.url ?? source.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

/**
 * Merge citation numbers onto sources already collected for a turn.
 */
export function applyCitation(
  sources: AskSource[],
  citation: { n: number; documentId: string }
): AskSource[] {
  return sources.map((source) =>
    source.id === citation.documentId ? { ...source, citationNumber: citation.n } : source
  );
}
