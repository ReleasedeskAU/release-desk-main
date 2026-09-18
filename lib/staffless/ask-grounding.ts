/**
 * Map tools used on an Ask turn onto a UI trust signal.
 * Presentation only — does not change which tools ran or how answers were computed.
 * "verified" means a catalog tool ran, not that open/overdue/related logic was correct.
 */

import {
  ASK_TOOL_BREAKDOWN,
  ASK_TOOL_DISTINCT,
  ASK_TOOL_DOCUMENT_BY_KEY,
  ASK_TOOL_GET_VERIFIED_COUNT,
  ASK_TOOL_LIST_MATCHING,
  ASK_TOOL_QUERYABLE_FIELDS,
  ASK_TOOL_SEARCH_INDEX,
  ASK_TOOL_DOCUMENT_CONTENT,
} from "@/lib/staffless/ask-tools";

export type AskGrounding = "verified" | "search" | "mixed";

const VERIFIED_TOOLS = new Set([
  ASK_TOOL_GET_VERIFIED_COUNT,
  ASK_TOOL_BREAKDOWN,
  ASK_TOOL_DISTINCT,
  ASK_TOOL_DOCUMENT_BY_KEY,
  ASK_TOOL_LIST_MATCHING,
  ASK_TOOL_QUERYABLE_FIELDS,
]);

/**
 * Classify a turn from the tool names already collected by the agent.
 * @param tools - Tool function names invoked this turn, in call order.
 * @returns verified (catalog), search (semantic), mixed, or null when no tools ran.
 */
export function askGroundingFromTools(tools: readonly string[]): AskGrounding | null {
  const verified = tools.some((name) => VERIFIED_TOOLS.has(name));
  const search =
    tools.includes(ASK_TOOL_SEARCH_INDEX) || tools.includes(ASK_TOOL_DOCUMENT_CONTENT);
  if (verified && search) return "mixed";
  if (verified) return "verified";
  if (search) return "search";
  return null;
}
