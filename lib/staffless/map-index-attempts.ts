/**
 * Strip StaffLess index-attempt payloads before they reach the browser.
 * Never forward stack traces or raw exception bodies.
 */

import { slackDeadTokenSlug } from "@/lib/staffless/reconnect";

export type StafflessIndexAttempt = {
  id: number;
  status: string | null;
  fromBeginning: boolean;
  newDocsIndexed: number;
  totalDocsIndexed: number;
  docsRemoved: number;
  errorMsg: string | null;
  errorCount: number;
  timeStarted: string | null;
  timeUpdated: string | null;
};

export type StafflessIndexError = {
  id: number;
  failureMessage: string;
  isResolved: boolean;
  timeCreated: string | null;
  documentId: string | null;
};

type RawAttempt = {
  id?: unknown;
  status?: unknown;
  from_beginning?: unknown;
  new_docs_indexed?: unknown;
  total_docs_indexed?: unknown;
  docs_removed_from_index?: unknown;
  error_msg?: unknown;
  error_count?: unknown;
  time_started?: unknown;
  time_updated?: unknown;
};

type RawError = {
  id?: unknown;
  failure_message?: unknown;
  is_resolved?: unknown;
  time_created?: unknown;
  document_id?: unknown;
};

function asInt(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Keep the first useful sentence and drop stack traces.
 * Index attempts store a short error_msg plus a separate full_exception_trace.
 */
export function plainIndexErrorMessage(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const stripped = raw
    .replace(/Traceback \(most recent call last\):[\s\S]*/i, "")
    .replace(/(?:\n|^)\s*at\s+\S.+/g, "")
    .trim();
  const blob = (stripped || raw.trim()).slice(0, 800);
  const mapped = mapKnownVendorIndexError(blob);
  if (mapped) return mapped.length > 300 ? `${mapped.slice(0, 297)}…` : mapped;
  const line = blob.split("\n")[0]?.trim() ?? "";
  if (!line) return "Index run failed";
  return line.length > 300 ? `${line.slice(0, 297)}…` : line;
}

/**
 * Replace vendor SDK strings (URLs, raw method names) with a named user message.
 * Dead-token Slack slugs win over join/history/scope copy so reconnect can match.
 * Does not guess which channel failed — that is not in the engine payload.
 */
export function mapKnownVendorIndexError(line: string): string | null {
  const authSlug = slackDeadTokenSlug(line);
  if (authSlug) return `Slack bot token was rejected (${authSlug}).`;
  const lower = line.toLowerCase();
  if (lower.includes("conversations.join") || /slack\.com\/api\/conversations\.join/i.test(line)) {
    return "Slack could not join that channel. Invite the bot to private channels, or grant the bot the channels:join scope for public channels.";
  }
  if (
    lower.includes("conversations.history") ||
    lower.includes("conversations.replies") ||
    /slack\.com\/api\/conversations\.(history|replies)/i.test(line)
  ) {
    return "This bot cannot read messages. Grant channels:history (and groups:history for private channels), reinstall the Slack app, and invite the bot to each channel you picked.";
  }
  if (lower.includes("users.info") || /slack\.com\/api\/users\.info/i.test(line)) {
    return "This bot cannot read who posted. Add users:read under Bot Token Scopes (not User Token Scopes), reinstall the app, then paste the new bot token with Replace credentials.";
  }
  if (lower.includes("the request to the slack api failed")) {
    return "Slack rejected a call while indexing this thread. Add users:read to Bot Token Scopes, reinstall, paste the new bot token (Replace credentials), invite the bot to the channel, then Re-index from beginning.";
  }
  return null;
}

/**
 * Map one StaffLess index attempt. Drops `full_exception_trace`.
 */
export function mapIndexAttempt(raw: unknown): StafflessIndexAttempt | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as RawAttempt;
  const id = asInt(row.id, 0);
  if (id <= 0) return null;
  return {
    id,
    status: asString(row.status),
    fromBeginning: row.from_beginning === true,
    newDocsIndexed: asInt(row.new_docs_indexed),
    totalDocsIndexed: asInt(row.total_docs_indexed),
    docsRemoved: asInt(row.docs_removed_from_index),
    errorMsg: plainIndexErrorMessage(asString(row.error_msg)),
    errorCount: asInt(row.error_count),
    timeStarted: asString(row.time_started),
    timeUpdated: asString(row.time_updated),
  };
}

/**
 * Map paginated StaffLess index attempts. Unknown items are skipped.
 */
export function mapIndexAttemptPage(payload: unknown): { items: StafflessIndexAttempt[]; total: number } {
  const body = payload && typeof payload === "object" ? (payload as { items?: unknown; total_items?: unknown }) : {};
  const items = Array.isArray(body.items) ? body.items.map(mapIndexAttempt).filter((v): v is StafflessIndexAttempt => v != null) : [];
  return { items, total: asInt(body.total_items, items.length) };
}

/**
 * Map one StaffLess index error. Keeps the failure message, not internals.
 */
export function mapIndexError(raw: unknown): StafflessIndexError | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as RawError;
  const id = asInt(row.id, 0);
  const failureMessage = plainIndexErrorMessage(asString(row.failure_message));
  if (id <= 0 || !failureMessage) return null;
  return {
    id,
    failureMessage,
    isResolved: row.is_resolved === true,
    timeCreated: asString(row.time_created),
    documentId: asString(row.document_id),
  };
}

/**
 * Map paginated StaffLess index errors.
 */
export function mapIndexErrorPage(payload: unknown): { items: StafflessIndexError[]; total: number } {
  const body = payload && typeof payload === "object" ? (payload as { items?: unknown; total_items?: unknown }) : {};
  const items = Array.isArray(body.items) ? body.items.map(mapIndexError).filter((v): v is StafflessIndexError => v != null) : [];
  return { items, total: asInt(body.total_items, items.length) };
}
