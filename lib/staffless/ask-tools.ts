/**
 * Closed Ask tool catalog. The model chooses tools; we do not phrase-match questions.
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import {
  ALLOWED_COUNT_FIELDS,
  getBreakdownByField,
  getDocumentByKey,
  getVerifiedCount,
  listDistinctValues,
  listDocumentsMatching,
  listQueryableFields,
} from "@/lib/staffless/ask-catalog";
import { ASK_TOOL_FAILURE_HINT } from "@/lib/staffless/ask-errors";
import {
  ASK_SOURCE_ALL,
  askSourceSlug,
  isAllowedAskSource,
  type AskIndexedSource,
  type AskSourceContext,
} from "@/lib/staffless/ask-source";
import { stafflessFetch } from "@/lib/staffless/client";
import { mapSearchDocsToWorkItems, type StafflessSearchDoc } from "@/lib/staffless/map-search-docs";
import { logger } from "@/lib/logger";

export const ASK_TOOL_GET_VERIFIED_COUNT = "get_verified_count";
export const ASK_TOOL_BREAKDOWN = "get_breakdown_by_field";
export const ASK_TOOL_DISTINCT = "list_distinct_values";
export const ASK_TOOL_DOCUMENT_BY_KEY = "get_document_by_key";
export const ASK_TOOL_LIST_MATCHING = "list_documents_matching";
export const ASK_TOOL_QUERYABLE_FIELDS = "list_queryable_fields";
export const ASK_TOOL_SEARCH_INDEX = "search_indexed_documents";
export const ASK_TOOL_INDEXED_SOURCES = "list_indexed_sources";

const MAX_SEARCH_DOCS = 25;
const SOURCE_ENUM = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((value, ctx) => {
    const slug = askSourceSlug(value);
    if (!slug) {
      ctx.addIssue({ code: "custom", message: "source must be all or an engine source id" });
      return z.NEVER;
    }
    return slug;
  });
const FIELD_ENUM = z.enum(ALLOWED_COUNT_FIELDS);
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SORT_ENUM = z.enum(["key_asc", "created_asc", "created_desc", "updated_asc", "updated_desc"]);
const filterPairSchema = z
  .object({
    filter_field: FIELD_ENUM,
    filter_value: z.string().trim().min(1).max(80),
  })
  .strict();

const countArgsSchema = z
  .object({
    source: SOURCE_ENUM.optional(),
    filter_field: FIELD_ENUM.optional(),
    filter_value: z.string().trim().min(1).max(80).optional(),
    filters: z.array(filterPairSchema).min(1).max(5).optional(),
    created_from: ISO_DATE.optional(),
    created_to: ISO_DATE.optional(),
    resolved_from: ISO_DATE.optional(),
    resolved_to: ISO_DATE.optional(),
    updated_from: ISO_DATE.optional(),
    updated_to: ISO_DATE.optional(),
    due_from: ISO_DATE.optional(),
    due_to: ISO_DATE.optional(),
    due_before: ISO_DATE.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasPair = value.filter_field !== undefined || value.filter_value !== undefined;
    if (value.filters && hasPair) {
      ctx.addIssue({ code: "custom", message: "Send filters or a single pair, not both" });
    }
    if ((value.filter_field === undefined) !== (value.filter_value === undefined)) {
      ctx.addIssue({ code: "custom", message: "filter_field and filter_value must be sent together" });
    }
  });

const fieldArgsSchema = z
  .object({
    source: SOURCE_ENUM.optional(),
    field: FIELD_ENUM,
    date_bucket: z.enum(["month"]).optional(),
  })
  .strict();

const lookupArgsSchema = z
  .object({
    source: SOURCE_ENUM.optional(),
    key: z.string().trim().min(1).max(40),
  })
  .strict();

const matchArgsSchema = z
  .object({
    source: SOURCE_ENUM.optional(),
    filter_field: FIELD_ENUM.optional(),
    filter_value: z.string().trim().min(1).max(80).optional(),
    filters: z.array(filterPairSchema).min(1).max(5).optional(),
    sort_by: SORT_ENUM.optional(),
    created_from: ISO_DATE.optional(),
    created_to: ISO_DATE.optional(),
    resolved_from: ISO_DATE.optional(),
    resolved_to: ISO_DATE.optional(),
    updated_from: ISO_DATE.optional(),
    updated_to: ISO_DATE.optional(),
    due_from: ISO_DATE.optional(),
    due_to: ISO_DATE.optional(),
    due_before: ISO_DATE.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasPair = value.filter_field !== undefined && value.filter_value !== undefined;
    const hasList = Boolean(value.filters?.length);
    const hasDate = hasDateRange(value);
    if (value.filters && (value.filter_field !== undefined || value.filter_value !== undefined) && !hasPair) {
      ctx.addIssue({ code: "custom", message: "Send filters or a single pair, not both" });
    }
    if (value.filters && hasPair) {
      ctx.addIssue({ code: "custom", message: "Send filters or a single pair, not both" });
    }
    if ((value.filter_field === undefined) !== (value.filter_value === undefined)) {
      ctx.addIssue({ code: "custom", message: "filter_field and filter_value must be sent together" });
    }
    if (!hasPair && !hasList && !hasDate) {
      ctx.addIssue({ code: "custom", message: "At least one filter or date range is required" });
    }
  });

const searchArgsSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    source: SOURCE_ENUM.optional(),
  })
  .strict();

function fnTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = []
): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    },
  };
}

function sourcePropFor(sourceIds: string[]): Record<string, unknown> {
  const enumValues = [ASK_SOURCE_ALL, ...sourceIds.filter((id) => id !== ASK_SOURCE_ALL)];
  return {
    type: "string",
    enum: enumValues,
    description: "Created connector source id, or all. Call list_indexed_sources when unsure.",
  };
}
const fieldProp = { type: "string", enum: [...ALLOWED_COUNT_FIELDS] };

const filterItemProp = {
  type: "object",
  additionalProperties: false,
  properties: {
    filter_field: fieldProp,
    filter_value: { type: "string", description: "Stored value after discovery; names may be a substring" },
  },
  required: ["filter_field", "filter_value"],
};
const filtersProp = { type: "array", minItems: 1, maxItems: 5, items: filterItemProp };
const isoDateProp = { type: "string", description: "YYYY-MM-DD" };
const dateRangeProps = {
  created_from: isoDateProp,
  created_to: isoDateProp,
  resolved_from: isoDateProp,
  resolved_to: isoDateProp,
  updated_from: isoDateProp,
  updated_to: isoDateProp,
  due_from: isoDateProp,
  due_to: isoDateProp,
  due_before: { type: "string", description: "YYYY-MM-DD exclusive upper bound on duedate" },
};

function hasDateRange(value: {
  created_from?: string;
  created_to?: string;
  resolved_from?: string;
  resolved_to?: string;
  updated_from?: string;
  updated_to?: string;
  due_from?: string;
  due_to?: string;
  due_before?: string;
}): boolean {
  return Boolean(
    value.created_from ||
      value.created_to ||
      value.resolved_from ||
      value.resolved_to ||
      value.updated_from ||
      value.updated_to ||
      value.due_from ||
      value.due_to ||
      value.due_before
  );
}

/**
 * OpenAI function tools for Ask. Source enum is this turn's created connectors plus all.
 */
export function buildAskTools(sourceIds: string[] = []): ChatCompletionTool[] {
  const sourceProp = sourcePropFor(sourceIds);
  return [
    fnTool(
      ASK_TOOL_INDEXED_SOURCES,
      "Created connector sources Ask can query this turn (id, label, searchable document count). Call when the user names a source or before claiming a source is missing. Do not assume a fixed vendor list.",
      {}
    ),
    fnTool(
      ASK_TOOL_QUERYABLE_FIELDS,
      "Published fields you may query (not raw database columns). Also returns resolved_status_category (done), status_category_values, date_range_params, sort_by, and list_projection. Does not include emails or other PII.",
      { source: sourceProp }
    ),
    fnTool(
      ASK_TOOL_GET_VERIFIED_COUNT,
      "Exact unique document count. Optional AND filters (issuetype + assignee + status_category) plus date ranges: created_from/to, resolved_from/to, updated_from/to, due_from/due_to/due_before (YYYY-MM-DD). Omit filters for a source total. source=github with no filter counts PRs/issues, not repositories — use list_distinct_values on repo for repository count. For names use contains (Kabir). For status_category use new, indeterminate, or done — not the status display name. Open/unresolved = count(status_category=new) + count(status_category=indeterminate). Resolved = count(status_category=done). Tickets missing status_category are not classified. Overdue = due_before=today AND status_category is new or indeterminate. Do not use for grouped breakdowns.",
      {
        source: sourceProp,
        filter_field: fieldProp,
        filter_value: { type: "string" },
        filters: filtersProp,
        ...dateRangeProps,
      }
    ),
    fnTool(
      ASK_TOOL_BREAKDOWN,
      "Exact unique-document counts grouped by one field. Prefer status_category (new / indeterminate / done) for open vs resolved. Status display names are labels only. For created/updated/duedate/resolution_date, date_bucket=month groups by YYYY-MM. Do not use search for grouped questions.",
      { source: sourceProp, field: fieldProp, date_bucket: { type: "string", enum: ["month"] } },
      ["field"]
    ),
    fnTool(
      ASK_TOOL_DISTINCT,
      "List stored values for one queryable field. Use before filtering on status, issuetype, object_type, or dates so you pass an exact stored string. For GitHub repository names or how-many-repos, use field=repo.",
      { source: sourceProp, field: fieldProp },
      ["field"]
    ),
    fnTool(
      ASK_TOOL_DOCUMENT_BY_KEY,
      "Exact lookup of one ticket by key. Returns allow-listed fields only (parent, duedate, status, status_category, issuelink, last_updater, status_was, …) never emails. Use for due date, parent, links, or last updater of a named ticket. For a follow-up about a listed set, call this for every key that is missing a needed field — not one key.",
      { source: sourceProp, key: { type: "string", description: "Exact ticket key, e.g. RD-82" } },
      ["key"]
    ),
    fnTool(
      ASK_TOOL_LIST_MATCHING,
      "Exact list of tickets matching AND filters and/or date ranges, including keys plus assignee, status, status_category, created, updated, duedate, priority. sort_by: key_asc, created_asc, created_desc, updated_asc, updated_desc. Children of an epic: parent=<epic key>. Subtasks: parent=<ticket> AND issuetype=Subtask. If truncated, say showing first cap of count. Never invent IDs.",
      {
        source: sourceProp,
        filter_field: fieldProp,
        filter_value: { type: "string" },
        filters: filtersProp,
        sort_by: {
          type: "string",
          enum: ["key_asc", "created_asc", "created_desc", "updated_asc", "updated_desc"],
        },
        ...dateRangeProps,
      }
    ),
    fnTool(
      ASK_TOOL_SEARCH_INDEX,
      "Ranked sample for what/tell-me-about content or title-collision candidates. Never use for how-many, parent, children, due dates, or listing IDs. Title matches are not description similarity.",
      { query: { type: "string" }, source: sourceProp },
      ["query"]
    ),
  ];
}

/** Default tool list when no live connectors were loaded (tests / fallback). */
export const ASK_TOOLS: ChatCompletionTool[] = buildAskTools([]);

export type AskToolDispatch = { name: string; result: string };

function invalidArgs(name: string): AskToolDispatch {
  return { name, result: JSON.stringify({ error: "invalid_args", hint: ASK_TOOL_FAILURE_HINT }) };
}

function unknownSource(name: string): AskToolDispatch {
  return {
    name,
    result: JSON.stringify({
      error: "unknown_source",
      hint: "Call list_indexed_sources and use a returned id, or source=all.",
    }),
  };
}

function rejectUnknownSource(
  name: string,
  source: string | undefined,
  context?: AskSourceContext
): AskToolDispatch | null {
  if (!source) return null;
  if (isAllowedAskSource(source, context)) return null;
  return unknownSource(name);
}

/**
 * Run one allow-listed Ask tool. Unknown names and extra args are rejected.
 * StaffLess failures become a structured tool result — they do not throw to the UI.
 * @param name - Tool name from the model.
 * @param rawArgs - JSON object the model supplied.
 * @param context - This turn's created connector sources (optional in unit tests).
 */
export async function dispatchAskTool(
  name: string,
  rawArgs: unknown,
  context?: AskSourceContext
): Promise<AskToolDispatch> {
  try {
    return await runAllowlistedTool(name, rawArgs, context);
  } catch (err) {
    logger.error("ask.tool_failed", { name, kind: err instanceof Error ? err.name : "unknown" });
    return { name, result: JSON.stringify({ error: "tool_failed", hint: ASK_TOOL_FAILURE_HINT }) };
  }
}

async function runAllowlistedTool(
  name: string,
  rawArgs: unknown,
  context?: AskSourceContext
): Promise<AskToolDispatch> {
  if (name === ASK_TOOL_INDEXED_SOURCES) {
    const parsed = z.object({}).strict().safeParse(rawArgs ?? {});
    if (!parsed.success) return invalidArgs(name);
    const sources: AskIndexedSource[] = context?.sources ?? [];
    return {
      name,
      result: JSON.stringify({
        sources,
        note: "Created connectors Ask can query. 0 documents means connected but not yet searchable.",
      }),
    };
  }
  if (name === ASK_TOOL_GET_VERIFIED_COUNT) {
    const parsed = countArgsSchema.safeParse(rawArgs);
    if (!parsed.success) return invalidArgs(name);
    const blocked = rejectUnknownSource(name, parsed.data.source, context);
    if (blocked) return blocked;
    return { name, result: JSON.stringify(await getVerifiedCount(parsed.data)) };
  }
  if (name === ASK_TOOL_QUERYABLE_FIELDS) {
    const parsed = z.object({ source: SOURCE_ENUM.optional() }).strict().safeParse(rawArgs ?? {});
    if (!parsed.success) return invalidArgs(name);
    const blocked = rejectUnknownSource(name, parsed.data.source, context);
    if (blocked) return blocked;
    return { name, result: JSON.stringify(await listQueryableFields()) };
  }
  if (name === ASK_TOOL_BREAKDOWN) {
    const parsed = fieldArgsSchema.safeParse(rawArgs);
    if (!parsed.success) return invalidArgs(name);
    const blocked = rejectUnknownSource(name, parsed.data.source, context);
    if (blocked) return blocked;
    return { name, result: JSON.stringify(await getBreakdownByField(parsed.data)) };
  }
  if (name === ASK_TOOL_DISTINCT) {
    const parsed = fieldArgsSchema.safeParse(rawArgs);
    if (!parsed.success) return invalidArgs(name);
    const blocked = rejectUnknownSource(name, parsed.data.source, context);
    if (blocked) return blocked;
    return { name, result: JSON.stringify(await listDistinctValues(parsed.data)) };
  }
  if (name === ASK_TOOL_DOCUMENT_BY_KEY) {
    const parsed = lookupArgsSchema.safeParse(rawArgs);
    if (!parsed.success) return invalidArgs(name);
    const blocked = rejectUnknownSource(name, parsed.data.source, context);
    if (blocked) return blocked;
    return { name, result: JSON.stringify(await getDocumentByKey(parsed.data)) };
  }
  if (name === ASK_TOOL_LIST_MATCHING) {
    const parsed = matchArgsSchema.safeParse(rawArgs);
    if (!parsed.success) return invalidArgs(name);
    const blocked = rejectUnknownSource(name, parsed.data.source, context);
    if (blocked) return blocked;
    return { name, result: JSON.stringify(await listDocumentsMatching(parsed.data)) };
  }
  if (name === ASK_TOOL_SEARCH_INDEX) {
    const parsed = searchArgsSchema.safeParse(rawArgs);
    if (!parsed.success) return invalidArgs(name);
    const blocked = rejectUnknownSource(name, parsed.data.source, context);
    if (blocked) return blocked;
    const docs = await searchIndexedSample(parsed.data.query, parsed.data.source);
    return { name, result: JSON.stringify({ sample: true, documents: docs }) };
  }
  return { name, result: JSON.stringify({ error: "unknown_tool", hint: ASK_TOOL_FAILURE_HINT }) };
}

async function searchIndexedSample(query: string, source?: string): Promise<unknown> {
  const filters: Record<string, unknown> = {};
  if (source && source !== "all") filters.source_type = [source];
  const body = await stafflessFetch<{ documents?: StafflessSearchDoc[] }>("/api/admin/search", {
    json: { query, filters },
  });
  return mapSearchDocsToWorkItems(body?.documents ?? []).slice(0, MAX_SEARCH_DOCS).map((row) => ({
    id: row.externalId,
    title: row.title,
    status: row.status,
    assignee: row.assignee,
    source: row.source,
  }));
}
