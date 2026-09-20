/**
 * Ask tool loop: the model chooses catalog vs search tools. No phrase matching.
 * Tool failures stay in the tool result; infrastructure failures use ASK_PUBLIC_UNAVAILABLE.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { randomUUID } from "node:crypto";
import { ASK_AGENT_SYSTEM, ASK_PUBLIC_UNAVAILABLE } from "@/lib/staffless/ask-copy";
import { listStafflessConnectors } from "@/lib/staffless/api";
import { formatAskSourceInventory, uniqueAskSources, type AskIndexedSource, type AskSourceContext } from "@/lib/staffless/ask-source";
import {
  formatDocumentByKeyAnswer,
  parseDocumentByKeyResult,
  shouldFormatTicketTable,
} from "@/lib/staffless/ask-format";
import { askGroundingFromTools } from "@/lib/staffless/ask-grounding";
import type { DocumentByKeyResult } from "@/lib/staffless/ask-catalog";
import {
  ASK_TOOL_DOCUMENT_BY_KEY,
  dispatchAskToolForTurn,
  type AskToolDispatch,
  type AskTurnLimits,
  buildAskTools,
} from "@/lib/staffless/ask-tools";
import { sourcesToAttachFromTool, selectAskSourceChips, type AskEvent, type AskSource, type AskSourceBatch } from "@/lib/staffless/ask-packets";
import { logger } from "@/lib/logger";

export const ASK_MAX_TOOL_ROUNDS = 8;
export const ASK_OPENAI_MAX_RETRIES = 3;

export type AskHistoryTurn = { role: "user" | "assistant"; content: string };

/** One tool invocation from the Ask loop, in call order. */
export type AskToolTraceCall = {
  round: number;
  name: string;
  arguments: unknown;
  result: string;
};

/** Result of one Ask tool loop, including traces for eval. */
export type AskToolLoopResult = {
  text: string;
  tools: string[];
  sources: AskSource[];
  calls: AskToolTraceCall[];
};

/**
 * Optional override for StaffLess dispatch. Production leaves this unset.
 * @param name - Tool function name.
 * @param rawArgs - Parsed tool arguments.
 * @param turn - Per-turn limits.
 * @param context - Indexed sources for this turn.
 * @param userQuestion - Current user question, when the tool needs it.
 */
export type AskToolDispatcher = (
  name: string,
  rawArgs: unknown,
  turn: AskTurnLimits,
  context?: AskSourceContext,
  userQuestion?: string
) => Promise<AskToolDispatch>;

/**
 * Run the Ask agent and yield the same AskEvent stream the UI already consumes.
 * @param message - Current user question.
 * @param history - Prior turns in this tab (not including the current question).
 * @param sessionId - Existing tab session, or a new UUID is minted.
 */
export async function* runAskAgent(opts: {
  message: string;
  history: AskHistoryTurn[];
  sessionId?: string;
}): AsyncGenerator<AskEvent> {
  const sessionId = opts.sessionId ?? randomUUID();
  yield { type: "session", sessionId };
  yield { type: "status", phase: "searching" };

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    logger.error("ask.agent_unconfigured", { kind: "missing_openai" });
    yield { type: "error", message: ASK_PUBLIC_UNAVAILABLE };
    yield { type: "done" };
    return;
  }

  const openai = new OpenAI({ apiKey, maxRetries: ASK_OPENAI_MAX_RETRIES });
  const indexedSources = await loadAskIndexedSources();
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: `${ASK_AGENT_SYSTEM}\n\n${formatAskSourceInventory(indexedSources)}` },
    ...opts.history.slice(-16).map((turn) => ({
      role: turn.role as "user" | "assistant",
      content: turn.content,
    })),
    { role: "user", content: opts.message },
  ];

  try {
    const { text, tools, sources } = await completeAskWithTools(openai, messages, {
      indexedSources,
      userQuestion: opts.message,
    });
    logger.info("ask.agent_tools", { tools, n: tools.length });
    yield { type: "status", phase: "answering" };
    if (!text) {
      yield { type: "error", message: ASK_PUBLIC_UNAVAILABLE };
      yield { type: "done" };
      return;
    }
    const grounding = askGroundingFromTools(tools);
    if (grounding) yield { type: "grounding", kind: grounding };
    if (sources.length > 0) yield { type: "sources", sources };
    yield { type: "text", text };
    yield { type: "done" };
  } catch (err) {
    logger.error("ask.agent_failed", { kind: err instanceof Error ? err.name : "unknown" });
    yield { type: "error", message: ASK_PUBLIC_UNAVAILABLE };
    yield { type: "done" };
  }
}

async function loadAskIndexedSources(): Promise<AskIndexedSource[]> {
  try {
    return uniqueAskSources(await listStafflessConnectors());
  } catch (err) {
    logger.warn("ask.sources_unavailable", { kind: err instanceof Error ? err.name : "unknown" });
    return [];
  }
}

/**
 * Run the Ask tool loop. Extra `calls` traces are for eval; production ignores them.
 * @param openai - OpenAI client (gpt-4o, temperature 0.2).
 * @param messages - System + history + current user question.
 * @param opts - Indexed sources, question, optional dispatch override.
 * @returns Final text, tool names, source chips, and per-call traces.
 */
export async function completeAskWithTools(
  openai: OpenAI,
  messages: ChatCompletionMessageParam[],
  opts?: {
    indexedSources?: AskIndexedSource[];
    userQuestion?: string;
    dispatchTool?: AskToolDispatcher;
  }
): Promise<AskToolLoopResult> {
  const indexedSources = opts?.indexedSources ?? [];
  const dispatchTool = opts?.dispatchTool ?? dispatchAskToolForTurn;
  const question = opts?.userQuestion ?? "";
  const toolDefs = buildAskTools(indexedSources.map((item) => item.id));
  const sourceContext = { sources: indexedSources };
  const tools: string[] = [];
  const batches: AskSourceBatch[] = [];
  const recorded: AskToolTraceCall[] = [];
  const turn: AskTurnLimits = { documentContentCalls: 0 };
  let lastDocument: DocumentByKeyResult | null = null;
  for (let round = 0; round < ASK_MAX_TOOL_ROUNDS; round += 1) {
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: toolDefs,
      tool_choice: "auto",
      temperature: 0.2,
      max_tokens: 1600,
    });
    const choice = res.choices[0]?.message;
    if (!choice) {
      return { text: "", tools, sources: selectAskSourceChips("", batches), calls: recorded };
    }
    const calls = choice.tool_calls ?? [];
    if (calls.length === 0) {
      const text = finalAskText(tools, lastDocument, choice.content, question);
      return {
        text,
        tools,
        sources: selectAskSourceChips(text, batches),
        calls: recorded,
      };
    }

    messages.push(choice);
    for (const call of calls) {
      if (call.type !== "function") continue;
      tools.push(call.function.name);
      let raw: unknown = {};
      try {
        raw = JSON.parse(call.function.arguments || "{}") as unknown;
      } catch {
        raw = {};
      }
      const dispatched = await dispatchTool(
        call.function.name,
        raw,
        turn,
        sourceContext,
        opts?.userQuestion
      );
      recorded.push({
        round: round + 1,
        name: call.function.name,
        arguments: raw,
        result: dispatched.result,
      });
      if (call.function.name === ASK_TOOL_DOCUMENT_BY_KEY) {
        lastDocument = parseDocumentByKeyResult(dispatched.result);
      }
      batches.push({
        tool: call.function.name,
        sources: sourcesToAttachFromTool(call.function.name, dispatched.result),
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: dispatched.result,
      });
    }
  }
  return { text: "", tools, sources: selectAskSourceChips("", batches), calls: recorded };
}

/**
 * Force a Field | Value table only when the user asked for fields/a table on a ticket-only turn.
 */
function finalAskText(
  tools: string[],
  document: DocumentByKeyResult | null,
  content: string | null | undefined,
  question: string
): string {
  if (document && shouldFormatTicketTable(tools, question)) {
    return formatDocumentByKeyAnswer(document);
  }
  return (content ?? "").trim();
}
