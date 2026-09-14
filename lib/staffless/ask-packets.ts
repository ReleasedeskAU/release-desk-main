/**
 * Map StaffLess chat NDJSON packets onto a small Ask event vocabulary.
 * Upstream error strings are dropped — they can leak internals.
 */

import { ASK_ADDITIONAL_CONTEXT, ASK_PUBLIC_UNAVAILABLE } from "@/lib/staffless/ask-copy";
import type { AskGrounding } from "@/lib/staffless/ask-grounding";

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
  const title =
    (typeof doc.semantic_identifier === "string" && doc.semantic_identifier.trim()) ||
    id;
  return {
    id,
    title,
    url: safeHttpUrl(doc.link),
    source: sourceLabel(typeof doc.source_type === "string" ? doc.source_type : ""),
  };
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
  if (!sourceType) return "Indexed";
  return sourceType.replace(/_/g, " ");
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
