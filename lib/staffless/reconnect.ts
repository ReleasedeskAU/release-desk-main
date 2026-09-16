/**
 * Classify index-attempt errors as reconnect-required (revoked/invalid token).
 * Generic across sources — not Jira-only. Never forwards stack traces.
 */

import type { ConnectorTableRow } from "@/lib/staffless/map-indexing-status";

export const RECONNECT_REQUIRED_MESSAGE =
  "Reconnect required. The token was rejected as invalid or revoked. Indexed copies may be stale.";

/**
 * Slack slugs that mean the bot token is dead. Not missing_scope or not_in_channel.
 * Index sanitization must keep these so this classifier can still match.
 */
export const SLACK_DEAD_TOKEN_SLUGS = [
  "invalid_auth",
  "token_revoked",
  "not_authed",
  "account_inactive",
  "token_expired",
] as const;

/**
 * First dead-token Slack slug in a vendor error string, or null.
 * Matches the slug token only — not a full Slack response body.
 */
export function slackDeadTokenSlug(message: string): string | null {
  const lower = message.toLowerCase();
  for (const slug of SLACK_DEAD_TOKEN_SLUGS) {
    if (lower.includes(slug)) return slug;
  }
  return null;
}

/**
 * True when the engine error looks like HTTP 401 / expired / invalid credential.
 * JQL validation, 403 permissions, missing Slack scopes, and generic failures stay false.
 */
export function looksLikeCredentialRejection(message: string | null | undefined): boolean {
  if (typeof message !== "string" || !message.trim()) return false;
  const lower = message.toLowerCase();
  if (/\b401\b/.test(lower)) return true;
  if (lower.includes("credential expired")) return true;
  if (lower.includes("credentials are expired")) return true;
  if (lower.includes("credential appears to be expired")) return true;
  if (lower.includes("invalid or revoked")) return true;
  if (slackDeadTokenSlug(lower)) return true;
  return false;
}

/**
 * Overlay reconnect copy on an ERROR row when the latest attempt is a credential rejection.
 */
export function withReconnectIfCredentialRejected(
  row: ConnectorTableRow,
  latestError: string | null | undefined
): ConnectorTableRow {
  if (row.status !== "ERROR" || !looksLikeCredentialRejection(latestError)) return row;
  return { ...row, lastError: RECONNECT_REQUIRED_MESSAGE, reconnectRequired: true };
}
