/**
 * Read a connector's stored secret on the server and keep it out of responses.
 * The browser sends a connector id. The unmasked JSON is used only to call the
 * vendor, then discarded. It is never logged and never returned.
 */

import { findStafflessConnector } from "@/lib/staffless/api";
import { StafflessApiError, stafflessFetch } from "@/lib/staffless/client";
import { toPositiveStafflessId } from "@/lib/staffless/ids";

export class StoredCredentialError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "StoredCredentialError";
    this.status = status;
  }
}

/** mask_string long form is exactly four chars, "...", four chars. */
const MASKED_LONG = /^.{4}\.\.\..{4}$/;

/**
 * Accept only plaintext credential fields. Masked placeholders fail closed.
 * The thrown message never includes the field value.
 * @param value - `credential_json` from the engine.
 * @returns String fields safe to use in memory.
 * @throws StoredCredentialError when the payload is missing or still masked.
 */
export function assertUnmaskedCredentialJson(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StoredCredentialError("Stored credential is unavailable", 502);
  }
  const out: Record<string, string> = {};
  for (const raw of Object.values(value as Record<string, unknown>)) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.includes("\u2022") || trimmed === "*****" || MASKED_LONG.test(trimmed)) {
      throw new StoredCredentialError("Stored credential is unavailable", 502);
    }
  }
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    out[key] = trimmed;
  }
  if (Object.keys(out).length === 0) {
    throw new StoredCredentialError("Stored credential is unavailable", 502);
  }
  return out;
}

const SECRET_KEY = /token|secret|password|credential|access_key/i;

/**
 * Drop any key that could carry a secret before a list/browse response is sent.
 * @param body - Vendor list payload.
 * @returns The same lists with secret-shaped keys removed.
 */
export function sanitizeListResponse(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * One required plaintext field. The error does not echo the value or the key's contents.
 * @param json - Unmasked credential JSON.
 * @param key - Engine credential field name.
 * @returns The field value.
 * @throws StoredCredentialError when the field is missing.
 */
export function requiredCredentialField(json: Record<string, string>, key: string): string {
  const value = json[key]?.trim();
  if (!value) throw new StoredCredentialError("Stored credential is unavailable", 502);
  return value;
}

export type StoredConnectorAuth = {
  baseUrl: string | null;
  config: Record<string, unknown>;
  credentialJson: Record<string, string>;
};

/**
 * Load the connector row and its unmasked credential. The secret stays in the
 * returned object for the caller to use in memory.
 * @param connectorId - StaffLess connector id from the wizard.
 * @param expectedType - Wizard type this list route serves.
 * @returns Row metadata plus plaintext credential JSON.
 * @throws StoredCredentialError when the id, type, or credential cannot be used.
 */
export async function resolveStoredConnector(
  connectorId: string,
  expectedType: string
): Promise<StoredConnectorAuth> {
  const id = toPositiveStafflessId(connectorId);
  if (id == null) throw new StoredCredentialError("Connector not found", 404);
  let row;
  try {
    row = await findStafflessConnector(String(id));
  } catch (err) {
    if (err instanceof StafflessApiError) {
      throw new StoredCredentialError("Stored credential is unavailable", 502);
    }
    throw new StoredCredentialError("Stored credential is unavailable", 502);
  }
  if (!row) throw new StoredCredentialError("Connector not found", 404);
  if (row.type !== expectedType) {
    throw new StoredCredentialError("This connector cannot be listed from here", 400);
  }
  let payload: unknown;
  try {
    payload = await stafflessFetch<unknown>(`/api/manage/admin/connector/${id}/credential-unmasked`);
  } catch (err) {
    if (err instanceof StafflessApiError && (err.status === 403 || err.status === 401)) {
      throw new StoredCredentialError("Stored credential is unavailable", 502);
    }
    if (err instanceof StafflessApiError && err.status === 404) {
      throw new StoredCredentialError("Connector not found", 404);
    }
    throw new StoredCredentialError("Stored credential is unavailable", 502);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new StoredCredentialError("Stored credential is unavailable", 502);
  }
  const credentialJson = assertUnmaskedCredentialJson(
    (payload as { credential_json?: unknown }).credential_json
  );
  return {
    baseUrl: row.baseUrl,
    config: (row.config ?? {}) as Record<string, unknown>,
    credentialJson,
  };
}
