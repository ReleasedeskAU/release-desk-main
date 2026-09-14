/**
 * Exact catalog reads from StaffLess Postgres tag APIs — not OpenSearch samples.
 */

import { stafflessFetch } from "@/lib/staffless/client";
import {
  ALLOWED_COUNT_FIELDS,
  PII_TAG_FIELDS,
  assignDateRangeFields,
  type CatalogFilterPair,
  type CountFilterField,
  type DateRangeArgs,
  type VerifiedCountArgs,
  type VerifiedCountResult,
  getVerifiedCount,
} from "@/lib/staffless/ask-count";

export { ALLOWED_COUNT_FIELDS, PII_TAG_FIELDS, getVerifiedCount };
export type {
  CatalogFilterPair,
  CountFilterField,
  DateRangeArgs,
  VerifiedCountArgs,
  VerifiedCountResult,
};

export const STAFFLESS_DOCUMENT_DISTINCT_PATH = "/api/admin/document-distinct";
export const STAFFLESS_DOCUMENT_BREAKDOWN_PATH = "/api/admin/document-breakdown";
export const STAFFLESS_DOCUMENT_BY_KEY_PATH = "/api/admin/document-by-key";
export const STAFFLESS_DOCUMENT_LIST_PATH = "/api/admin/document-list";
export const STAFFLESS_DOCUMENT_FIELDS_PATH = "/api/admin/document-fields";

export type CatalogFieldArgs = {
  source?: string;
  field: CountFilterField;
  date_bucket?: "month";
};

export type DistinctValuesResult = {
  field: string;
  source: string;
  values: string[];
  untagged_count: number;
  total_indexed: number;
  truncated: boolean;
  note: string;
};

export type BreakdownGroup = { value: string; count: number };

export type BreakdownResult = {
  field: string;
  source: string;
  groups: BreakdownGroup[];
  untagged_count: number;
  total_indexed: number;
  truncated: boolean;
  note: string;
};

export type DocumentByKeyArgs = {
  source?: string;
  key: string;
};

export type DocumentByKeyResult = {
  found: boolean;
  key: string;
  title?: string;
  link?: string | null;
  source: string;
  fields?: Record<string, string | string[]>;
  note: string;
};

export type DocumentMatchArgs = DateRangeArgs & {
  source?: string;
  filter_field?: CountFilterField;
  filter_value?: string;
  filters?: CatalogFilterPair[];
  sort_by?: "key_asc" | "created_asc" | "created_desc" | "updated_asc" | "updated_desc";
};

export type MatchingDocument = {
  key: string | null;
  title: string | null;
  link: string | null;
  assignee?: string | null;
  status?: string | null;
  status_category?: string | null;
  created?: string | null;
  updated?: string | null;
  duedate?: string | null;
  priority?: string | null;
};

export type DocumentListResult = {
  count: number;
  returned: number;
  cap: number;
  source: string;
  filters: Array<{ filter_field: string; filter_value: string; matched_values: string[] }>;
  filter_field: string | null;
  filter_value: string | null;
  matched_values: string[];
  documents: MatchingDocument[];
  truncated: boolean;
  note: string;
};

export type QueryableFieldsResult = {
  fields: string[];
  contains_match: string[];
  exact_match: string[];
  resolved_status_category?: string;
  status_category_values?: string[];
  date_range_fields?: string[];
  date_range_params?: string[];
  sort_by?: string[];
  list_projection?: string[];
  cap: number;
  note: string;
};

export async function listQueryableFields(): Promise<QueryableFieldsResult> {
  const result = await stafflessFetch<QueryableFieldsResult>(STAFFLESS_DOCUMENT_FIELDS_PATH, {
    json: {},
  });
  const fields = stringList(result?.fields, 40).filter(
    (field) => !PII_TAG_FIELDS.includes(field as (typeof PII_TAG_FIELDS)[number])
  );
  return {
    fields,
    contains_match: stringList(result?.contains_match, 40),
    exact_match: stringList(result?.exact_match, 40),
    cap: finiteCount(result?.cap) || 50,
    resolved_status_category:
      typeof result?.resolved_status_category === "string"
        ? result.resolved_status_category.trim().toLowerCase()
        : undefined,
    status_category_values: stringList(result?.status_category_values, 8),
    date_range_fields: stringList(result?.date_range_fields, 20),
    date_range_params: stringList(result?.date_range_params, 20),
    sort_by: stringList(result?.sort_by, 20),
    list_projection: stringList(result?.list_projection, 20),
    note:
      typeof result?.note === "string"
        ? result.note
        : "Queryable indexed tags only. Date ranges use created_from/to, due_before, and related params.",
  };
}

function sourceBody(source?: string): Record<string, string> {
  return source && source !== "all" ? { source } : {};
}

function finiteCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function stringList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, cap);
}

/**
 * Exact distinct tag values for one allow-listed field.
 * @param args - Source and required field.
 * @throws StafflessApiError when StaffLess rejects the request.
 */
export async function listDistinctValues(args: CatalogFieldArgs): Promise<DistinctValuesResult> {
  const result = await stafflessFetch<DistinctValuesResult>(STAFFLESS_DOCUMENT_DISTINCT_PATH, {
    json: { ...sourceBody(args.source), field: args.field },
  });
  return {
    field: typeof result?.field === "string" ? result.field : args.field,
    source: typeof result?.source === "string" ? result.source : args.source ?? "all",
    values: stringList(result?.values, 50),
    untagged_count: finiteCount(result?.untagged_count),
    total_indexed: finiteCount(result?.total_indexed),
    truncated: result?.truncated === true,
    note: distinctNote(args.field),
  };
}

function distinctNote(field: string): string {
  if (field === "repo") {
    return "Each value is a repository owner/name. Repository count is the number of values, not total_indexed (that is document count).";
  }
  if (field === "object_type") {
    return "GitHub stores PullRequest and Issue here. Document count filtered by object_type is PRs or issues, not repositories.";
  }
  return "Exact distinct indexed tag values, not a search sample.";
}

/**
 * Exact unique-document counts grouped by one allow-listed field.
 * @param args - Source and required field.
 * @throws StafflessApiError when StaffLess rejects the request.
 */
export async function getBreakdownByField(args: CatalogFieldArgs): Promise<BreakdownResult> {
  const result = await stafflessFetch<BreakdownResult>(STAFFLESS_DOCUMENT_BREAKDOWN_PATH, {
    json: {
      ...sourceBody(args.source),
      field: args.field,
      ...(args.date_bucket ? { date_bucket: args.date_bucket } : {}),
    },
  });
  const groups = Array.isArray(result?.groups)
    ? result.groups
        .slice(0, 50)
        .map((row) => ({
          value: typeof row?.value === "string" ? row.value : "",
          count: finiteCount(row?.count),
        }))
        .filter((row) => row.value)
    : [];
  return {
    field: typeof result?.field === "string" ? result.field : args.field,
    source: typeof result?.source === "string" ? result.source : args.source ?? "all",
    groups,
    untagged_count: finiteCount(result?.untagged_count),
    total_indexed: finiteCount(result?.total_indexed),
    truncated: result?.truncated === true,
    note: "Exact unique indexed document counts grouped by field, not a search sample.",
  };
}

/**
 * Exact indexed document lookup by ticket/document key.
 * @param args - Key such as RD-82; optional source.
 * @throws StafflessApiError when StaffLess rejects the request.
 */
export async function getDocumentByKey(args: DocumentByKeyArgs): Promise<DocumentByKeyResult> {
  const result = await stafflessFetch<DocumentByKeyResult>(STAFFLESS_DOCUMENT_BY_KEY_PATH, {
    json: { ...sourceBody(args.source), key: args.key },
  });
  const found = result?.found === true;
  return {
    found,
    key: typeof result?.key === "string" ? result.key : args.key,
    title: typeof result?.title === "string" ? result.title : undefined,
    link: typeof result?.link === "string" ? result.link : null,
    source: typeof result?.source === "string" ? result.source : args.source ?? "all",
    fields: found && result?.fields && typeof result.fields === "object" ? sanitizeFields(result.fields) : undefined,
    note: found
      ? "Exact indexed document lookup by key, not a search ranking."
      : "No indexed document with this exact key.",
  };
}

/**
 * Exact indexed documents matching one allow-listed field value, with keys.
 * @param args - Filter field/value such as labels=release123.
 * @throws StafflessApiError when StaffLess rejects the request.
 */
export async function listDocumentsMatching(args: DocumentMatchArgs): Promise<DocumentListResult> {
  const json: Record<string, unknown> = { ...sourceBody(args.source) };
  if (args.filters && args.filters.length > 0) json.filters = args.filters;
  else {
    if (args.filter_field) json.filter_field = args.filter_field;
    if (args.filter_value) json.filter_value = args.filter_value;
  }
  if (args.sort_by) json.sort_by = args.sort_by;
  assignDateRangeFields(json, args);
  const result = await stafflessFetch<DocumentListResult>(STAFFLESS_DOCUMENT_LIST_PATH, { json });
  const documents = Array.isArray(result?.documents)
    ? result.documents.slice(0, 50).map((row) => mapMatchingDocument(row))
    : [];
  const filters = Array.isArray(result?.filters)
    ? result.filters.slice(0, 5).map((row) => ({
        filter_field: typeof row?.filter_field === "string" ? row.filter_field : "",
        filter_value: typeof row?.filter_value === "string" ? row.filter_value : "",
        matched_values: stringList(row?.matched_values, 20),
      }))
    : [];
  const truncated = result?.truncated === true;
  const count = finiteCount(result?.count);
  return {
    count,
    returned: finiteCount(result?.returned) || documents.length,
    cap: finiteCount(result?.cap) || 50,
    source: typeof result?.source === "string" ? result.source : args.source ?? "all",
    filters,
    filter_field: typeof result?.filter_field === "string" ? result.filter_field : args.filter_field ?? null,
    filter_value: typeof result?.filter_value === "string" ? result.filter_value : args.filter_value ?? null,
    matched_values: stringList(result?.matched_values, 20),
    documents,
    truncated,
    note: truncated
      ? `Showing first ${documents.length} of ${count} matching indexed documents.`
      : "Exact indexed documents matching this filter, not a search sample.",
  };
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function mapMatchingDocument(row: MatchingDocument | Record<string, unknown>): MatchingDocument {
  return {
    key: typeof row?.key === "string" && row.key.trim() ? row.key : null,
    title: typeof row?.title === "string" ? row.title : null,
    link: typeof row?.link === "string" ? row.link : null,
    assignee: optionalText(row.assignee),
    status: optionalText(row.status),
    created: optionalText(row.created),
    updated: optionalText(row.updated),
    duedate: optionalText(row.duedate),
    priority: optionalText(row.priority),
  };
}

function sanitizeFields(raw: Record<string, unknown>): Record<string, string | string[]> {
  const allowed = new Set<string>(ALLOWED_COUNT_FIELDS);
  const blocked = new Set<string>(PII_TAG_FIELDS);
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key) || blocked.has(key)) continue;
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value)) out[key] = value.filter((item): item is string => typeof item === "string").slice(0, 20);
  }
  return out;
}
