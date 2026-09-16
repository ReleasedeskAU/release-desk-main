/**
 * Classify index-attempt errors as reconnect-required (revoked/invalid token).
 * Generic across sources — not Jira-only. Never forwards stack traces.
 */

import type { ConnectorTableRow } from "@/lib/staffless/map-indexing-status";

export const RECONNECT_REQUIRED_MESSAGE =
  "Reconnect required. The token was rejected as invalid or revoked. Indexed copies may be stale.";

/**
 * True when the engine error looks like HTTP 401 / expired / invalid credential.
 * JQL validation, 403 permissions, and generic failures stay false.
 */
export function looksLikeCredentialRejection(message: string | null | undefined): boolean {
  if (typeof message !== "string" || !message.trim()) return false;
  const lower = message.toLowerCase();
  if (/\b401\b/.test(lower)) return true;
  if (lower.includes("credential expired")) return true;
  if (lower.includes("credentials are expired")) return true;
  if (lower.includes("credential appears to be expired")) return true;
  if (lower.includes("invalid or revoked")) return true;
  if (lower.includes("invalid_auth")) return true;
  if (lower.includes("token_expired")) return true;
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
