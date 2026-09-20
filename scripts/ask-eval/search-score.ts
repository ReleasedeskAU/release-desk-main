/**
 * Score hybrid admin-search hits for Ask eval fixtures.
 * Ask scoreAskEvalTurn is tool-routing; this is rank of the fixture document.
 */

import type { SearchTimePairCase } from "./cases";
import type { AskEvalCaseId, SearchEvalCaseId } from "./types";
import type { StafflessSearchDoc } from "../../lib/staffless/map-search-docs";

export type SearchRankKind = "identity" | "missing" | "not_applicable" | "time_pair";

export type SearchRankScore = {
  kind: SearchRankKind;
  top1: boolean | null;
  top3: boolean | null;
  top10: boolean | null;
  rank: number | null;
  reason: string;
};

const BN_378 = /\bBN-378\b/i;
const THREAD_A1 = /TESTFACT-A1/i;
const THREAD_A2 = /TESTFACT-A2/i;
const MISSING_KEY = /\bRD-999999\b/i;

/**
 * Rank the fixture document (or N/A) from an admin-search hit list.
 * @param id - Ask eval case id.
 * @param documents - Hits in returned order (already reranked when the flag is on).
 */
export function scoreSearchRank(
  id: SearchEvalCaseId,
  documents: readonly StafflessSearchDoc[],
  timePair?: SearchTimePairCase
): SearchRankScore {
  if (timePair) return scoreTimePair(timePair, documents);
  if (id === "GH_CLOSED" || id === "GH_REPOS" || id === "RESOLVED") {
    return {
      kind: "not_applicable",
      top1: null,
      top3: null,
      top10: null,
      rank: null,
      reason: "count_or_distinct_not_a_document",
    };
  }
  if (id === "MISSING") {
    const rank = firstMatchRank(documents, isMissingKey);
    return {
      kind: "missing",
      top1: rank === null,
      top3: rank === null,
      top10: rank === null,
      rank,
      reason: rank === null ? "missing_key_absent" : "missing_key_present",
    };
  }
  const match = matcherFor(id);
  const rank = firstMatchRank(documents, match);
  return {
    kind: "identity",
    top1: rank === 1,
    top3: rank !== null && rank <= 3,
    top10: rank !== null && rank <= 10,
    rank,
    reason: rank === null ? "fixture_absent" : `fixture_rank_${rank}`,
  };
}

/**
 * Recent doc must outrank the older matching doc. top1 is recent at rank 1.
 */
export function scoreTimePair(
  pair: SearchTimePairCase,
  documents: readonly StafflessSearchDoc[]
): SearchRankScore {
  const recent = firstMatchRank(documents, (doc) =>
    haystack(doc, true).toLowerCase().includes(pair.recentNeedle.toLowerCase())
  );
  const older = firstMatchRank(documents, (doc) =>
    haystack(doc, true).toLowerCase().includes(pair.olderNeedle.toLowerCase())
  );
  if (recent === null || older === null) {
    return {
      kind: "time_pair",
      top1: false,
      top3: false,
      top10: false,
      rank: recent,
      reason: recent === null && older === null ? "pair_absent" : recent === null ? "recent_absent" : "older_absent",
    };
  }
  const favored = recent < older;
  return {
    kind: "time_pair",
    top1: favored && recent === 1,
    top3: favored && recent <= 3,
    top10: favored,
    rank: recent,
    reason: favored ? `recent_rank_${recent}_before_${older}` : `recent_rank_${recent}_after_${older}`,
  };
}

function matcherFor(id: AskEvalCaseId): (doc: StafflessSearchDoc) => boolean {
  switch (id) {
    case "JIRA_KEY":
    case "DESC":
      return (doc) => haystack(doc, false).search(BN_378) >= 0;
    case "THREAD_A1":
      return (doc) => haystack(doc, true).search(THREAD_A1) >= 0;
    case "THREAD_A2":
      return (doc) => haystack(doc, true).search(THREAD_A2) >= 0;
    case "AUTHOR":
    case "CHANNEL":
      return isSlackSocial;
    default:
      return () => false;
  }
}

function isMissingKey(doc: StafflessSearchDoc): boolean {
  return haystack(doc, false).search(MISSING_KEY) >= 0;
}

/**
 * Slack #social post. Channel tag or the indexed "in #social" title — not the word
 * "social" in an unrelated body.
 */
function isSlackSocial(doc: StafflessSearchDoc): boolean {
  if ((doc.source_type || "").toLowerCase() !== "slack") return false;
  const channel = metaString(doc.metadata, "channel");
  if (channel && channel.toLowerCase() === "social") return true;
  return /#social\b/i.test(doc.semantic_identifier || "");
}

function firstMatchRank(
  documents: readonly StafflessSearchDoc[],
  match: (doc: StafflessSearchDoc) => boolean
): number | null {
  const index = documents.findIndex(match);
  return index < 0 ? null : index + 1;
}

function haystack(doc: StafflessSearchDoc, includeBlurb: boolean): string {
  const parts = [doc.document_id || "", doc.semantic_identifier || ""];
  if (includeBlurb) parts.push(doc.blurb || "");
  return parts.join("\n");
}

function metaString(
  metadata: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!metadata) return null;
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
