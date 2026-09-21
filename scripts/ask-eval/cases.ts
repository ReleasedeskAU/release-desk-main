/**
 * Closed historical Ask cases. Tenant fixtures live here, not in ASK_AGENT_SYSTEM.
 */

import type { AskIndexedSource } from "../../lib/staffless/ask-source";
import type { AskEvalCase, AskEvalCaseId } from "./types";

export const ASK_EVAL_CASES: AskEvalCase[] = [
  { id: "GH_CLOSED", question: "How many PRs are closed?", requiresSource: "github" },
  { id: "AUTHOR", question: "Who posted in the social channel?", requiresSource: "slack" },
  {
    id: "THREAD_A2",
    question: "What was said in the TESTFACT-A2 Slack thread, including the replies?",
    requiresSource: "slack",
  },
  {
    id: "THREAD_A1",
    question: "What was said in the TESTFACT-A1 Slack thread?",
    requiresSource: "slack",
  },
  { id: "JIRA_KEY", question: "what is BN-378 about", requiresSource: "jira" },
  { id: "CHANNEL", question: "What was posted in the social channel?", requiresSource: "slack" },
  { id: "GH_REPOS", question: "How many GitHub repositories?", requiresSource: "github" },
  { id: "DESC", question: "What is the full description of BN-378?", requiresSource: "jira" },
  { id: "RESOLVED", question: "How many tickets are resolved?", requiresSource: "jira" },
  { id: "MISSING", question: "What is RD-999999 about?", requiresSource: "jira" },
  {
    id: "LATEST_MESSAGE",
    question: "what is the latest message from admin in the social channel",
    requiresSource: "slack",
  },
  {
    id: "GRAPH_BLOCKERS",
    question: "What is blocking RD-114?",
    requiresSource: "jira",
  },
  {
    id: "GRAPH_CLOSURE",
    question: "What does release 36.2 touch?",
    requiresSource: "jira",
  },
  {
    id: "GRAPH_CHILDREN",
    question: "What are the children of BN-15?",
    requiresSource: "jira",
  },
];

/**
 * Skip when the required source is missing or has zero indexed documents.
 * @param requiresSource - Connector id the case needs.
 * @param sources - This turn's created connectors.
 * @returns Skip reason, or null when the case can run.
 */
export function skipReasonForSource(
  requiresSource: AskEvalCase["requiresSource"],
  sources: readonly AskIndexedSource[]
): string | null {
  const row = sources.find((item) => item.id === requiresSource);
  if (!row) return `source_missing:${requiresSource}`;
  if (row.docsIndexed <= 0) return `source_empty:${requiresSource}`;
  return null;
}

const CASE_IDS = new Set(ASK_EVAL_CASES.map((row) => row.id));

/**
 * Filter the closed list by optional `--cases` ids.
 * @param ids - Case ids from CLI, or empty for the full list.
 */
export function selectAskEvalCases(ids: readonly string[]): AskEvalCase[] {
  if (ids.length === 0) return ASK_EVAL_CASES;
  const unknown = ids.filter((id) => !CASE_IDS.has(id as AskEvalCaseId));
  if (unknown.length > 0) throw new Error(`unknown cases: ${unknown.join(",")}`);
  const wanted = new Set(ids);
  return ASK_EVAL_CASES.filter((row) => wanted.has(row.id));
}
