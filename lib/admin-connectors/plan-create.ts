/**
 * Build index-engine create bodies from the Admin Connectors catalog.
 * Only allow-listed field names are sent. Secrets are not logged.
 */

import { parseOptionalIndexingStart } from "@/lib/jira/project-keys";
import { getAdminConnectorSource } from "./catalog";
import { isCatalogSourceReady, type CatalogField } from "./types";

export type CatalogCreateInput = {
  source: string;
  name: string;
  credentials?: Record<string, unknown>;
  config?: Record<string, unknown>;
  pollInterval?: number;
  indexingStart?: string | null;
};

export type CatalogCreatePlan = {
  credential: {
    name: string;
    source: string;
    admin_public: boolean;
    credential_json: Record<string, string | boolean>;
  };
  connector: {
    name: string;
    source: string;
    input_type: "poll" | "load_state";
    access_type: "public";
    groups: number[];
    refresh_freq: number;
    indexing_start?: string | null;
    connector_specific_config: Record<string, unknown>;
  };
};

export class CatalogCreateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogCreateError";
  }
}

function refreshSeconds(pollInterval?: number): number {
  return Math.max(60, (pollInterval ?? 15) * 60);
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  return value
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseFieldValue(field: CatalogField, raw: unknown): unknown {
  if (field.type === "list") return parseList(raw);
  if (field.type === "checkbox") {
    if (typeof raw === "boolean") return raw;
    if (raw === "true" || raw === "on" || raw === "1") return true;
    if (raw === "false" || raw === "off" || raw === "0" || raw === "" || raw == null) {
      return field.default === true;
    }
    return Boolean(raw);
  }
  if (field.type === "number") {
    if (raw === "" || raw == null) return field.default;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) throw new CatalogCreateError(`${field.label} must be a number`);
    return n;
  }
  const text = asTrimmedString(raw);
  if (!text) return field.default;
  return text;
}

function isEmptyValue(value: unknown): boolean {
  if (value == null) return true;
  if (value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function pickFields(
  fields: CatalogField[],
  incoming: Record<string, unknown> | undefined,
  kind: "credentials" | "options"
): Record<string, unknown> {
  const allowed = new Set(fields.map((field) => field.name));
  for (const key of Object.keys(incoming ?? {})) {
    if (!allowed.has(key)) {
      throw new CatalogCreateError(`Unexpected ${kind} field`);
    }
  }
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.passToEngine === false) continue;
    const parsed = parseFieldValue(field, incoming?.[field.name]);
    if (field.type === "checkbox") {
      out[field.name] = parsed === true;
      continue;
    }
    if (isEmptyValue(parsed)) {
      if (field.optional) continue;
      throw new CatalogCreateError(`${field.label} is required`);
    }
    out[field.name] = parsed;
  }
  return out;
}

/**
 * Validate catalog input and build credential + connector bodies.
 * @throws CatalogCreateError when the source is unknown, not ready, or fields are invalid.
 */
export function planCatalogCreate(input: CatalogCreateInput): CatalogCreatePlan {
  const sourceId = asTrimmedString(input.source).toLowerCase();
  const name = asTrimmedString(input.name);
  if (!name) throw new CatalogCreateError("Name is required");
  const source = getAdminConnectorSource(sourceId);
  if (!source) throw new CatalogCreateError("Unknown connector source");
  if (!isCatalogSourceReady(source) || source.id === "xenforo") {
    throw new CatalogCreateError("This source cannot be added yet");
  }

  const indexingStart = parseOptionalIndexingStart(input.indexingStart);
  if (indexingStart === false) {
    throw new CatalogCreateError("Sync start date is not valid");
  }

  const credentialJson = pickFields(source.credentialFields, input.credentials, "credentials");
  const config = pickFields(source.configFields, input.config, "options");

  return {
    credential: {
      name: `${name} credentials`,
      source: source.id,
      admin_public: true,
      credential_json: credentialJson as Record<string, string | boolean>,
    },
    connector: {
      name,
      source: source.id,
      input_type: source.inputType,
      access_type: "public",
      groups: [],
      refresh_freq: refreshSeconds(input.pollInterval),
      ...(indexingStart !== undefined ? { indexing_start: indexingStart } : {}),
      connector_specific_config: config,
    },
  };
}
