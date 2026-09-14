/**
 * Exact unique-document counts from StaffLess POST /admin/document-count.
 * Not OpenSearch top-N search.
 */

import { stafflessFetch } from "@/lib/staffless/client";

export const STAFFLESS_DOCUMENT_COUNT_PATH = "/api/admin/document-count";

export const ALLOWED_COUNT_FIELDS = [
  "assignee",
  "status",
  "priority",
  "project",
  "project_name",
  "labels",
  "issuetype",
  "reporter",
  "key",
  "parent",
  "duedate",
  "created",
  "updated",
  "resolution",
  "resolution_date",
  "issuelink",
  "issuelink_type",
  "last_updater",
  "status_was",
  "status_category",
  "repo",
  "object_type",
  "num_files_changed",
  "num_commits",
] as const;

export const PII_TAG_FIELDS = ["assignee_email", "reporter_email"] as const;

export type CountFilterField = (typeof ALLOWED_COUNT_FIELDS)[number];

export type CatalogFilterPair = {
  filter_field: CountFilterField;
  filter_value: string;
};

export type DateRangeArgs = {
  created_from?: string;
  created_to?: string;
  resolved_from?: string;
  resolved_to?: string;
  updated_from?: string;
  updated_to?: string;
  due_from?: string;
  due_to?: string;
  due_before?: string;
};

export type VerifiedCountArgs = DateRangeArgs & {
  source?: string;
  filter_field?: CountFilterField;
  filter_value?: string;
  filters?: CatalogFilterPair[];
};

export type ResolvedCatalogFilter = {
  filter_field: string;
  filter_value: string;
  matched_values: string[];
};

export type VerifiedCountResult = {
  count: number;
  source: string;
  filters: ResolvedCatalogFilter[];
  filter_field: string | null;
  filter_value: string | null;
  matched_values: string[];
  note: string;
};

const DATE_RANGE_KEYS = [
  "created_from",
  "created_to",
  "resolved_from",
  "resolved_to",
  "updated_from",
  "updated_to",
  "due_from",
  "due_to",
  "due_before",
] as const;

/** Copy allow-listed YYYY-MM-DD range fields onto a StaffLess body. */
export function assignDateRangeFields(
  body: Record<string, unknown>,
  args: DateRangeArgs
): void {
  for (const key of DATE_RANGE_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) body[key] = value.trim();
  }
}

function countBody(args: VerifiedCountArgs): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (args.source && args.source !== "all") body.source = args.source;
  if (args.filters && args.filters.length > 0) body.filters = args.filters;
  else {
    if (args.filter_field) body.filter_field = args.filter_field;
    if (args.filter_value) body.filter_value = args.filter_value;
  }
  assignDateRangeFields(body, args);
  return body;
}

/**
 * Call StaffLess for an exact unique indexed-document count.
 * @param args - Optional source and AND metadata filters.
 * @throws StafflessApiError when the count API rejects the request.
 */
export async function getVerifiedCount(args: VerifiedCountArgs): Promise<VerifiedCountResult> {
  const result = await stafflessFetch<VerifiedCountResult>(STAFFLESS_DOCUMENT_COUNT_PATH, {
    json: countBody(args),
  });
  const count = typeof result?.count === "number" && Number.isFinite(result.count) ? Math.floor(result.count) : 0;
  const matched = Array.isArray(result?.matched_values)
    ? result.matched_values.filter((v): v is string => typeof v === "string").slice(0, 20)
    : [];
  const filters = Array.isArray(result?.filters)
    ? result.filters
        .slice(0, 5)
        .map((row) => ({
          filter_field: typeof row?.filter_field === "string" ? row.filter_field : "",
          filter_value: typeof row?.filter_value === "string" ? row.filter_value : "",
          matched_values: Array.isArray(row?.matched_values)
            ? row.matched_values.filter((v): v is string => typeof v === "string").slice(0, 20)
            : [],
        }))
        .filter((row) => row.filter_field)
    : [];
  return {
    count: Math.max(0, count),
    source: typeof result?.source === "string" ? result.source : args.source ?? "all",
    filters,
    filter_field: typeof result?.filter_field === "string" ? result.filter_field : null,
    filter_value: typeof result?.filter_value === "string" ? result.filter_value : null,
    matched_values: matched,
    note: githubCountNote(
      typeof result?.source === "string" ? result.source : undefined,
      args.source,
      "Exact unique indexed document count, not a search sample."
    ),
  };
}

/** GitHub source totals are PRs/issues, never a repository census. */
function githubCountNote(source: string | undefined, requested: string | undefined, base: string): string {
  if (source !== "github" && requested !== "github") return base;
  return `${base} GitHub count is unique indexed documents (pull requests and issues), not repositories. Repository count is how many distinct repo values exist.`;
}
