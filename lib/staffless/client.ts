/**
 * HTTP client for StaffLess AI. Server-side only — PAT never leaves this module.
 */

import { logger } from "@/lib/logger";
import { stafflessBaseUrl, stafflessPat } from "@/lib/staffless/config";

export class StafflessConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StafflessConfigError";
  }
}

export class StafflessApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "StafflessApiError";
    this.status = status;
  }
}

type JsonBody = Record<string, unknown> | unknown[];

/** Chat streams can run well past the 30s JSON timeout used for connector calls. */
export const STAFFLESS_STREAM_TIMEOUT_MS = 180_000;

function stafflessUrlAndPat(path: string): { url: string; pat: string } {
  const pat = stafflessPat();
  if (!pat) {
    throw new StafflessConfigError("StaffLess AI PAT is not configured");
  }
  if (!path.startsWith("/")) {
    throw new StafflessConfigError("StaffLess AI path must be absolute");
  }
  return { url: `${stafflessBaseUrl()}${path}`, pat };
}

function stafflessAuthHeaders(pat: string, json: boolean): HeadersInit {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/json",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

/**
 * Call StaffLess AI with the server PAT. Prefer `/api/...` paths (nginx strips `/api`).
 * @param path - Absolute path beginning with `/`.
 * @param init - Fetch options; JSON body is serialized when `json` is set.
 * @returns Parsed JSON, or null for empty 204.
 * @throws StafflessConfigError when PAT is missing.
 * @throws StafflessApiError on non-2xx.
 */
export async function stafflessFetch<T>(
  path: string,
  init: { method?: string; json?: JsonBody; timeoutMs?: number } = {}
): Promise<T> {
  const { url, pat } = stafflessUrlAndPat(path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, {
      method: init.method ?? (init.json ? "POST" : "GET"),
      headers: stafflessAuthHeaders(pat, Boolean(init.json)),
      body: init.json ? JSON.stringify(init.json) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      logger.warn("staffless.fetch_failed", { status: res.status, path });
      throw new StafflessApiError(res.status, publicStafflessError(res.status, text));
    }
    if (!text) return null as T;
    return JSON.parse(text) as T;
  } catch (err) {
    if (err instanceof StafflessApiError || err instanceof StafflessConfigError) throw err;
    logger.error("staffless.fetch_error", { path, kind: err instanceof Error ? err.name : "unknown" });
    throw new StafflessApiError(502, "StaffLess AI is unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * POST and return the raw Response so the caller can stream NDJSON.
 * Drains error bodies without exposing them — upstream JSON can include internals.
 * @param path - Absolute path beginning with `/`.
 * @param init.json - JSON body (required).
 * @returns Upstream Response with a readable body.
 * @throws StafflessConfigError when PAT is missing.
 * @throws StafflessApiError on non-2xx or missing body.
 */
export async function stafflessFetchStream(
  path: string,
  init: { json: JsonBody; timeoutMs?: number; signal?: AbortSignal }
): Promise<Response> {
  const { url, pat } = stafflessUrlAndPat(path);
  const timeout = AbortSignal.timeout(init.timeoutMs ?? STAFFLESS_STREAM_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: stafflessAuthHeaders(pat, true),
      body: JSON.stringify(init.json),
      signal,
      cache: "no-store",
    });
    if (!res.ok) {
      await res.text().catch(() => "");
      logger.warn("staffless.stream_failed", { status: res.status, path });
      throw new StafflessApiError(res.status, publicStafflessError(res.status));
    }
    if (!res.body) throw new StafflessApiError(502, "StaffLess AI is unavailable");
    return res;
  } catch (err) {
    if (err instanceof StafflessApiError || err instanceof StafflessConfigError) throw err;
    logger.error("staffless.stream_error", { path, kind: err instanceof Error ? err.name : "unknown" });
    throw new StafflessApiError(502, "StaffLess AI is unavailable");
  }
}

/**
 * Client-facing error. Optional engine body is scanned for known phrases only —
 * never returned or logged.
 */
export function publicStafflessError(status: number, engineBody?: string): string {
  const mapped = mapKnownEngineRejection(engineBody);
  if (mapped) return mapped;
  if (status === 401 || status === 403) return "StaffLess AI rejected the request";
  if (status === 404) return "StaffLess AI resource not found";
  if (status === 409) return "StaffLess AI reported a conflict";
  if (status >= 400 && status < 500) return "StaffLess AI rejected the request";
  return "StaffLess AI is unavailable";
}

function mapKnownEngineRejection(engineBody?: string): string | null {
  if (!engineBody) return null;
  const lower = engineBody.toLowerCase();
  if (lower.includes("unexpected keyword")) {
    return "The index engine rejected this source configuration. Restart the index engine and try again.";
  }
  if (lower.includes("duplicate naming not allowed") || lower.includes("already exists, duplicate")) {
    return "A connector with this name already exists. Use a different name, or delete the leftover connector.";
  }
  if (
    lower.includes("bitbucket") &&
    (lower.includes("invalid or expired") || lower.includes("http 401"))
  ) {
    return "Bitbucket rejected the credentials.";
  }
  if (
    lower.includes("bitbucket") &&
    (lower.includes("insufficient permissions") || lower.includes("http 403"))
  ) {
    return "Bitbucket denied access to that workspace.";
  }
  if (lower.includes("bitbucket") && (lower.includes("status=404") || lower.includes("http 404"))) {
    return "Bitbucket could not find that workspace.";
  }
  return null;
}

export function stafflessHttpStatus(err: unknown): number {
  if (err instanceof StafflessConfigError) return 503;
  if (err instanceof StafflessApiError) return err.status >= 400 ? Math.min(err.status, 502) : 502;
  return 502;
}

export function stafflessPublicMessage(err: unknown): string {
  if (err instanceof StafflessConfigError) return "StaffLess AI is not configured";
  if (err instanceof StafflessApiError) return err.message;
  return "StaffLess AI is unavailable";
}
