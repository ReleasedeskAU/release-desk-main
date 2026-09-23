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
  | "SOURCE_FOLLOWUP";

export type AskEvalOutcome = "pass" | "fail" | "infra" | "skip";

export type AskEvalCase = {
  id: AskEvalCaseId;
  question: string;
  requiresSource: "github" | "slack" | "jira" | "teams";
  /** Prior user turn; when set, the runner scores only the follow-up. */
  priorQuestion?: string;
  /** Connector the prior question named; reused on the follow-up is a fail. */
  priorSource?: string;
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
