/**
 * Score one Ask eval turn from the answer plus tool traces.
 * Infra is not a model fail. Tenant phrases stay here, not in the prompt.
 */

import { ASK_PUBLIC_UNAVAILABLE } from "../../lib/staffless/ask-errors";
import type { AskToolTraceCall } from "../../lib/staffless/ask-agent";
import type { AskEvalCaseId, AskEvalScore } from "./types";

type FilterPair = { field: string; value: string };

/**
 * Score one completed Ask turn for a historical case.
 * @param id - Case id from the closed list.
 * @param text - Final answer text.
 * @param calls - Tool traces in call order.
 * @param priorSource - Connector named on a prior turn; reused here is a fail.
 * @returns pass, fail, or infra — never skip (skip is decided before the call).
 */
export function scoreAskEvalTurn(
  id: AskEvalCaseId,
  text: string,
  calls: readonly AskToolTraceCall[],
  priorSource?: string
): AskEvalScore {
  if (isInfraAnswer(text)) return { outcome: "infra", reason: "unavailable_or_empty" };
  if (hasRetryableToolFailure(calls)) {
    return { outcome: "infra", reason: "retryable_tool_failure" };
  }
  switch (id) {
    case "GH_CLOSED":
      return scoreGhClosed(text, calls);
    case "AUTHOR":
      return scoreAuthor(text, calls);
    case "THREAD_A2":
      return scoreThread(text, calls, "TESTFACT-A2", true);
    case "THREAD_A1":
      return scoreThread(text, calls, "TESTFACT-A1", false);
    case "JIRA_KEY":
      return scoreJiraKey(text, calls);
    case "CHANNEL":
      return scoreChannel(text, calls);
    case "GH_REPOS":
      return scoreGhRepos(text, calls);
    case "DESC":
      return scoreDesc(text, calls);
    case "RESOLVED":
      return scoreResolved(text, calls);
    case "MISSING":
      return scoreMissing(text, calls);
    case "LATEST_MESSAGE":
      return scoreLatestMessage(text, calls);
    case "GRAPH_BLOCKERS":
      return scoreGraphBlockers(text, calls);
    case "GRAPH_CLOSURE":
      return scoreGraphClosure(text, calls);
    case "GRAPH_CHILDREN":
      return scoreGraphChildren(text, calls);
    case "SOURCE_FOLLOWUP":
      return scoreSourceFollowup(calls, priorSource);
    case "SCHEDULED_TEAMS_CONF":
    case "SCHEDULED_TEAMS_CONF_TYPO":
      return scoreScheduled(text, calls);
    default:
      return { outcome: "fail", reason: "unknown_case" };
  }
}

function hasRetryableToolFailure(calls: readonly AskToolTraceCall[]): boolean {
  return calls.some((call) => {
    try {
      const payload = JSON.parse(call.result) as { error?: unknown; retryable?: unknown };
      return payload.error === "tool_failed" && payload.retryable === true;
    } catch {
      return false;
    }
  });
}

function isInfraAnswer(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return t === ASK_PUBLIC_UNAVAILABLE;
}

function argsOf(calls: readonly AskToolTraceCall[], name: string): Record<string, unknown>[] {
  return calls.filter((c) => c.name === name).map((c) => asRecord(c.arguments));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function listedFilters(args: Record<string, unknown>): FilterPair[] {
  const out: FilterPair[] = [];
  if (typeof args.filter_field === "string" && typeof args.filter_value === "string") {
    out.push({ field: args.filter_field, value: args.filter_value });
  }
  if (Array.isArray(args.filters)) {
    for (const row of args.filters) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const field = (row as { filter_field?: unknown }).filter_field;
      const value = (row as { filter_value?: unknown }).filter_value;
      if (typeof field === "string" && typeof value === "string") {
        out.push({ field, value });
      }
    }
  }
  for (const field of ["object_type", "state", "merged", "status_category", "status", "channel", "key", "repo"]) {
    const value = args[field];
    if (typeof value === "string" && value.trim()) out.push({ field, value });
  }
  return out;
}

function allFilters(calls: readonly AskToolTraceCall[]): FilterPair[] {
  return calls.flatMap((c) => listedFilters(asRecord(c.arguments)));
}

function hasFilter(calls: readonly AskToolTraceCall[], field: string, value?: string): boolean {
  return allFilters(calls).some((f) => {
    if (f.field.toLowerCase() !== field.toLowerCase()) return false;
    if (value === undefined) return true;
    return f.value.toLowerCase() === value.toLowerCase();
  });
}

function scoreGhClosed(text: string, calls: readonly AskToolTraceCall[]): AskEvalScore {
  const t = text.toLowerCase();
  const usedMerged = hasFilter(calls, "merged");
  const closedOnly = hasFilter(calls, "state", "closed") && !usedMerged;
  if (/\brejected\b/.test(t) && !usedMerged && !/\bmerged\b/.test(t)) {
    return { outcome: "fail", reason: "closed_as_rejected" };
  }
  if (closedOnly && !/\bmerged\b/.test(t)) {
    return { outcome: "fail", reason: "closed_without_merged" };
  }
  if (usedMerged || /\bmerged\b/.test(t)) return { outcome: "pass", reason: "merged_disambiguated" };
  return { outcome: "fail", reason: "no_merged_check" };
}

function scoreAuthor(text: string, calls: readonly AskToolTraceCall[]): AskEvalScore {
  const t = text.toLowerCase();
  const searched =
    calls.some((c) => c.name === "search_indexed_documents") ||
    calls.some((c) => c.name === "get_document_content");
  const listedAuthors = calls.some((call) => {
    if (call.name !== "list_documents_matching") return false;
    try {
      const payload = JSON.parse(call.result) as { documents?: Array<{ author?: unknown }> };
      return payload.documents?.some(
        (document) => typeof document.author === "string" && document.author.trim().length > 0
      ) === true;
    } catch {
      return false;
    }
  });
  const claimedAbsent =
    t.includes("not found") ||
    t.includes("could not find") ||
    t.includes("couldn't find") ||
    t.includes("re-index") ||
    t.includes("reindex") ||
    t.includes("no one posted") ||
    t.includes("nobody posted");
  if (claimedAbsent && !searched) return { outcome: "fail", reason: "absent_without_search" };
  if (t.includes("admin") || t.includes("posted") || listedAuthors || searched) {
    return { outcome: "pass", reason: "author_or_search" };
  }
  return { outcome: "fail", reason: "no_author_path" };
}

function scoreThread(
  text: string,
  calls: readonly AskToolTraceCall[],
  token: string,
  needReplies: boolean
): AskEvalScore {
  const t = text.toLowerCase();
  const tokenLc = token.toLowerCase();
  if (channelIsToken(calls, tokenLc)) return { outcome: "fail", reason: "channel=token" };
  if (byKeyIsToken(calls, tokenLc)) return { outcome: "fail", reason: "by_key=token" };
  const searched = argsOf(calls, "search_indexed_documents").some((a) =>
    String(a.query ?? "").toLowerCase().includes(tokenLc)
  );
  const content = calls.some((c) => c.name === "get_document_content");
  if (!searched) return { outcome: "fail", reason: "no_search_token" };
  if (needReplies) {
    const hasParent = t.includes("webhook") || t.includes("testfact-a2x") || t.includes("5 attempts");
    const hasReply = t.includes("reply 1") || t.includes("reply 2");
    if (hasParent && hasReply) return { outcome: "pass", reason: "parent_and_replies" };
    if (hasParent) return { outcome: "fail", reason: "parent_only" };
    return { outcome: "fail", reason: "no_thread_content" };
  }
  const hasA1 = t.includes("42.7") || t.includes("42.9") || t.includes("latency");
  if (hasA1 && content) return { outcome: "pass", reason: "thread_content" };
  if (hasA1) return { outcome: "pass", reason: "thread_content" };
  return { outcome: "fail", reason: "no_thread_content" };
}

function channelIsToken(calls: readonly AskToolTraceCall[], tokenLc: string): boolean {
  return allFilters(calls).some(
    (f) => f.field.toLowerCase() === "channel" && f.value.toLowerCase().includes(tokenLc)
  );
}

function byKeyIsToken(calls: readonly AskToolTraceCall[], tokenLc: string): boolean {
  return argsOf(calls, "get_document_by_key").some((a) =>
    String(a.key ?? "").toLowerCase().includes(tokenLc)
  );
}

function scoreJiraKey(text: string, calls: readonly AskToolTraceCall[]): AskEvalScore {
  const t = text.toLowerCase();
  if (channelIsToken(calls, "testfact")) return { outcome: "fail", reason: "channel=token" };
  const used = argsOf(calls, "get_document_by_key").some((a) =>
    String(a.key ?? "").toUpperCase().includes("BN-378")
  );
  if (!used) return { outcome: "fail", reason: "no_get_document_by_key" };
  if (t.includes("not in the index") || t.includes("could not find")) {
    return { outcome: "fail", reason: "missing_ticket" };
  }
  if (t.includes("bn-378")) return { outcome: "pass", reason: "named_ticket" };
  return { outcome: "fail", reason: "no_ticket_content" };
}

function scoreChannel(text: string, calls: readonly AskToolTraceCall[]): AskEvalScore {
  const t = text.toLowerCase();
  if (channelIsToken(calls, "testfact")) return { outcome: "fail", reason: "channel=token" };
  const social = allFilters(calls).some(
    (f) => f.field.toLowerCase() === "channel" && f.value.toLowerCase() === "social"
  );
  const hasPosts =
    t.includes("testfact") || t.includes("hello") || t.includes("hi") || t.includes("webhook");
  if (social && hasPosts) return { outcome: "pass", reason: "channel=social" };
  if (social) return { outcome: "pass", reason: "channel=social" };
  if (hasPosts) return { outcome: "fail", reason: "posts_without_channel_tag" };
  return { outcome: "fail", reason: "no_channel_social" };
}

function scoreGhRepos(text: string, calls: readonly AskToolTraceCall[]): AskEvalScore {
  const t = text.toLowerCase();
  const distinctRepo = argsOf(calls, "list_distinct_values").some(
    (a) => String(a.field ?? "").toLowerCase() === "repo"
  );
  const bareGithubCount = argsOf(calls, "get_verified_count").some((a) => {
    const source = String(a.source ?? "").toLowerCase();
    if (source && source !== "github") return false;
    return listedFilters(a).length === 0;
  });
  if (bareGithubCount && !distinctRepo && (t.includes("repositor") || t.includes("repos"))) {
    return { outcome: "fail", reason: "docs_as_repos" };
  }
  if (distinctRepo) return { outcome: "pass", reason: "distinct_repo" };
  return { outcome: "fail", reason: "no_distinct_repo" };
}

function scoreDesc(text: string, calls: readonly AskToolTraceCall[]): AskEvalScore {
  const t = text.toLowerCase();
  if (t.includes("not indexed") || t.includes("aren't indexed") || t.includes("are not indexed")) {
    return { outcome: "fail", reason: "said_not_indexed" };
  }
  if (!calls.some((c) => c.name === "get_document_content")) {
    return { outcome: "fail", reason: "no_document_content" };
  }
  if (t.includes("bn-378") || t.length > 40) return { outcome: "pass", reason: "body_fetched" };
  return { outcome: "fail", reason: "empty_description" };
}

function scoreResolved(_text: string, calls: readonly AskToolTraceCall[]): AskEvalScore {
  const statusWord = allFilters(calls).some(
    (f) =>
      f.field.toLowerCase() === "status" &&
      /^(done|closed|resolved)$/i.test(f.value.trim())
  );
  const categoryDone = hasFilter(calls, "status_category", "done");
  if (statusWord && !categoryDone) return { outcome: "fail", reason: "status_display_name" };
  if (categoryDone) return { outcome: "pass", reason: "status_category=done" };
  return { outcome: "fail", reason: "no_status_category" };
}

function scoreMissing(text: string, calls: readonly AskToolTraceCall[]): AskEvalScore {
  const t = text.toLowerCase();
  const byKey = argsOf(calls, "get_document_by_key").some((a) =>
    String(a.key ?? "").toUpperCase().includes("RD-999999")
  );
  const foundOther = calls.some((c) => {
    if (c.name !== "get_document_by_key") return false;
    try {
      const obj = JSON.parse(c.result) as { found?: unknown; key?: unknown };
      return obj.found === true && String(obj.key ?? "").toUpperCase() !== "RD-999999";
    } catch {
      return false;
    }
  });
  if (foundOther && !t.includes("not in the index") && !t.includes("could not find") && !t.includes("no indexed")) {
    return { outcome: "fail", reason: "neighbor_as_asked" };
  }
  const missing =
    t.includes("not in the index") ||
    t.includes("not found in the indexed") ||
    t.includes("could not find") ||
    t.includes("couldn't find") ||
    t.includes("no indexed") ||
    t.includes("does not exist") ||
    t.includes("wasn't found") ||
    t.includes("was not found");
  if (missing) return { outcome: "pass", reason: "not_in_index" };
  if (byKey) return { outcome: "fail", reason: "lookup_without_refusal" };
  return { outcome: "fail", reason: "did_not_refuse" };
}

function scoreLatestMessage(text: string, calls: readonly AskToolTraceCall[]): AskEvalScore {
  if (calls.some((c) => c.name === "search_indexed_documents")) {
    return { outcome: "fail", reason: "used_search" };
  }
  const listed = latestDateDescList(calls);
  if (!listed) return { outcome: "fail", reason: "no_date_desc_list" };
  if (!hasFilter(calls, "channel", "social")) return { outcome: "fail", reason: "no_channel_social" };
  const author = allFilters(calls).some(
    (f) => f.field.toLowerCase() === "author" && f.value.toLowerCase().includes("admin")
  );
  if (!author) return { outcome: "fail", reason: "no_author_admin" };
  if (!listed.first) return { outcome: "fail", reason: "empty_list" };
  if (!answerCitesListRow(text, listed.first)) return { outcome: "fail", reason: "answer_not_first_row" };
  return { outcome: "pass", reason: "list_date_desc" };
}

type ListRow = { document_id?: unknown; key?: unknown; title?: unknown; link?: unknown };

function latestDateDescList(
  calls: readonly AskToolTraceCall[]
): { first: ListRow | null } | null {
  let found: { first: ListRow | null } | null = null;
  for (const call of calls) {
    if (call.name !== "list_documents_matching") continue;
    const sortBy = String(asRecord(call.arguments).sort_by ?? "").toLowerCase();
    if (sortBy !== "created_desc" && sortBy !== "updated_desc") continue;
    try {
      const payload = JSON.parse(call.result) as { documents?: ListRow[] };
      const docs = Array.isArray(payload.documents) ? payload.documents : [];
      found = { first: docs[0] ?? null };
    } catch {
      found = { first: null };
    }
  }
  return found;
}

function answerCitesListRow(text: string, row: ListRow): boolean {
  const t = text.toLowerCase();
  for (const value of [row.document_id, row.link, row.key, row.title]) {
    if (typeof value !== "string") continue;
    const needle = value.trim();
    if (needle.length < 4) continue;
    if (t.includes(needle.toLowerCase())) return true;
  }
  return false;
}

/**
 * Stage 1 graph scorers. Live tenants carry their own link vocabularies, so
 * these score tool-choice discipline (graph over search, stored kinds over
 * guesses); exact key-set proof lives in lib/staffless/ask-graph.test.ts.
 */
function usedSearchForDeps(calls: readonly AskToolTraceCall[]): boolean {
  return calls.some((c) => c.name === "search_indexed_documents");
}

function distinctKinds(calls: readonly AskToolTraceCall[]): string[] {
  const out: string[] = [];
  for (const call of calls) {
    if (call.name !== "list_distinct_values") continue;
    if (String(asRecord(call.arguments).field ?? "").toLowerCase() !== "issuelink_type") continue;
    try {
      const payload = JSON.parse(call.result) as { values?: unknown };
      if (!Array.isArray(payload.values)) continue;
      for (const value of payload.values) {
        if (typeof value === "string" && value.trim()) out.push(value.toLowerCase());
      }
    } catch {
      continue;
    }
  }
  return out;
}

function graphArgs(calls: readonly AskToolTraceCall[], name: string): Record<string, unknown>[] {
  return argsOf(calls, name);
}

function scoreGraphBlockers(text: string, calls: readonly AskToolTraceCall[]): AskEvalScore {
  if (usedSearchForDeps(calls)) return { outcome: "fail", reason: "used_search_for_deps" };
  const linked = graphArgs(calls, "get_linked_work_items");
  if (linked.length === 0) return { outcome: "fail", reason: "no_graph_tool" };
  const kinds = linked
    .map((a) => String(a.link_kind ?? "").toLowerCase())
    .filter((k) => k.length > 0);
  const stored = distinctKinds(calls);
  if (kinds.some((k) => stored.length > 0 && !stored.includes(k))) {
    return { outcome: "fail", reason: "link_kind_guessed" };
  }
  if (kinds.length > 0 && stored.length === 0) return { outcome: "fail", reason: "link_kind_without_discovery" };
  void text;
  return { outcome: "pass", reason: "graph_blockers" };
}

function scoreGraphClosure(text: string, calls: readonly AskToolTraceCall[]): AskEvalScore {
  if (usedSearchForDeps(calls)) return { outcome: "fail", reason: "used_search_for_deps" };
  if (graphArgs(calls, "get_dependency_closure").length === 0) {
    return { outcome: "fail", reason: "no_graph_tool" };
  }
  void text;
  return { outcome: "pass", reason: "graph_closure" };
}

/**
 * Follow-up that named no connector: every sourced tool must be all or omitted.
 * Reusing the prior turn's source is the original regression.
 */
function scoreSourceFollowup(
  calls: readonly AskToolTraceCall[],
  priorSource?: string
): AskEvalScore {
  const sourced = calls.filter((call) => call.name !== "list_indexed_sources");
  if (sourced.length === 0) return { outcome: "fail", reason: "no_source_query" };
  const prior = priorSource?.trim().toLowerCase() ?? "";
  for (const call of sourced) {
    const source = String(asRecord(call.arguments).source ?? "")
      .trim()
      .toLowerCase();
    if (!source || source === "all") continue;
    if (prior && source === prior) return { outcome: "fail", reason: "reused_prior_source" };
    return { outcome: "fail", reason: "named_source" };
  }
  return { outcome: "pass", reason: "all_or_omitted" };
}

function scoreGraphChildren(text: string, calls: readonly AskToolTraceCall[]): AskEvalScore {
  if (usedSearchForDeps(calls)) return { outcome: "fail", reason: "used_search_for_deps" };
  const viaGraph = graphArgs(calls, "get_linked_work_items").some(
    (a) => String(a.relation ?? "linked").toLowerCase() === "children"
  );
  const viaCatalog = allFilters(calls).some((f) => f.field.toLowerCase() === "parent");
  if (!viaGraph && !viaCatalog) return { outcome: "fail", reason: "no_children_path" };
  void text;
  return { outcome: "pass", reason: viaGraph ? "graph_children" : "catalog_children_parity" };
}

/**
 * "When is X scheduled" must be content search with source=all ??? no catalog
 * detour, no clarifying deferral. The schedule row (Teams) must be cited;
 * Confluence rows must be cited when the sample contains them. Body reads of
 * already-found rows are search-family grounding, not a detour.
 */
const SCHEDULED_CATALOG_TOOLS = new Set([
  "get_verified_count",
  "get_breakdown_by_field",
  "list_distinct_values",
  "get_document_by_key",
  "list_documents_matching",
  "list_queryable_fields",
  "get_linked_work_items",
  "get_dependency_closure",
]);

const SCHEDULED_DEFERRAL = /which (connector|source)s?\b|do you want me to (search|check)|could you (clarify|specify)/i;

type ScheduledRow = { source?: unknown; title?: unknown; link?: unknown; document_id?: unknown };

function isTeamsRow(source: unknown): boolean {
  const s = String(source ?? "").toLowerCase();
  return s === "teams" || s === "microsoft teams";
}

function isConfluenceRow(source: unknown): boolean {
  return String(source ?? "").toLowerCase().includes("confluence");
}

function scheduledSearchRows(calls: readonly AskToolTraceCall[]): ScheduledRow[] {
  const out: ScheduledRow[] = [];
  for (const call of calls) {
    if (call.name !== "search_indexed_documents") continue;
    try {
      const payload = JSON.parse(call.result) as { documents?: ScheduledRow[] };
      if (Array.isArray(payload.documents)) out.push(...payload.documents);
    } catch {
      continue;
    }
  }
  return out;
}

function scoreScheduled(text: string, calls: readonly AskToolTraceCall[]): AskEvalScore {
  const detour = calls.find((c) => SCHEDULED_CATALOG_TOOLS.has(c.name));
  if (detour) return { outcome: "fail", reason: "catalog_detour" };
  const searches = argsOf(calls, "search_indexed_documents");
  if (searches.length === 0) return { outcome: "fail", reason: "no_search" };
  const allSource = searches.some((a) => {
    const source = String(a.source ?? "all").toLowerCase();
    return source === "all" || source === "";
  });
  if (!allSource) return { outcome: "fail", reason: "not_source_all_search" };
  if (SCHEDULED_DEFERRAL.test(text)) return { outcome: "fail", reason: "clarifying_deferral" };
  const rows = scheduledSearchRows(calls);
  const teams = rows.filter((r) => isTeamsRow(r.source));
  const conf = rows.filter((r) => isConfluenceRow(r.source));
  // The schedule answer lives in the Teams row ??? it must be cited. Confluence
  // rows are cited only when the sample actually contains them; a Teams+Jira
  // sample with a Teams citation is the verified live shape, not a failure.
  if (!teams.some((r) => answerCitesListRow(text, r))) {
    return { outcome: "fail", reason: "single_source_citation" };
  }
  if (conf.length > 0 && !conf.some((r) => answerCitesListRow(text, r))) {
    return { outcome: "fail", reason: "single_source_citation" };
  }
  return { outcome: "pass", reason: "scheduled_teams_conf" };
}
