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
 * @returns pass, fail, or infra — never skip (skip is decided before the call).
 */
export function scoreAskEvalTurn(
  id: AskEvalCaseId,
  text: string,
  calls: readonly AskToolTraceCall[]
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
