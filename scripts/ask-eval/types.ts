/**
 * Shared types for the Ask historical eval harness.
 */

import type { AskToolTraceCall } from "../../lib/staffless/ask-agent";

export type AskEvalCaseId =
  | "GH_CLOSED"
  | "AUTHOR"
  | "THREAD_A2"
  | "THREAD_A1"
  | "JIRA_KEY"
  | "CHANNEL"
  | "GH_REPOS"
  | "DESC"
  | "RESOLVED"
  | "MISSING"
  | "LATEST_MESSAGE"
  | "GRAPH_BLOCKERS"
  | "GRAPH_CLOSURE"
  | "GRAPH_CHILDREN"
  | "SCHEDULED_TEAMS_CONF"
  | "SCHEDULED_TEAMS_CONF_TYPO";

export type AskEvalOutcome = "pass" | "fail" | "infra" | "skip";

export type AskEvalCase = {
  id: AskEvalCaseId;
  question: string;
  requiresSource: "github" | "slack" | "jira" | "teams" | "confluence";
  /** Second source that must also be indexed (multi-source cases). */
  alsoRequiresSource?: "github" | "slack" | "jira" | "teams" | "confluence";
};

export type AskEvalScore = {
  outcome: AskEvalOutcome;
  reason: string;
};

export type AskEvalRun = {
  id: AskEvalCaseId;
  n: number;
  question: string;
  outcome: AskEvalOutcome;
  reason: string;
  grounding: string | null;
  tools: string[];
  calls: AskToolTraceCall[];
  text: string;
  duration_ms: number;
  error?: string;
};
