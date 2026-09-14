/**
 * Ask tool loop: the model chooses catalog vs search tools. No phrase matching.
 * Tool failures stay in the tool result; infrastructure failures use ASK_PUBLIC_UNAVAILABLE.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { randomUUID } from "node:crypto";
import { ASK_AGENT_SYSTEM, ASK_PUBLIC_UNAVAILABLE } from "@/lib/staffless/ask-copy";
import { listStafflessConnectors } from "@/lib/staffless/api";
import { formatAskSourceInventory, uniqueAskSources, type AskIndexedSource } from "@/lib/staffless/ask-source";
import {
  formatDocumentByKeyAnswer,
  parseDocumentByKeyResult,
  shouldFormatTicketTable,
} from "@/lib/staffless/ask-format";
import { askGroundingFromTools } from "@/lib/staffless/ask-grounding";
import type { DocumentByKeyResult } from "@/lib/staffless/ask-catalog";
import { ASK_TOOL_DOCUMENT_BY_KEY, buildAskTools, dispatchAskTool } from "@/lib/staffless/ask-tools";
import type { AskEvent } from "@/lib/staffless/ask-packets";
import { logger } from "@/lib/logger";

export const ASK_MAX_TOOL_ROUNDS = 8;

export type AskHistoryTurn = { role: "user" | "assistant"; content: string };

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

  const openai = new OpenAI({ apiKey });
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
    const { text, tools } = await completeAskWithTools(openai, messages, {
      allowTicketTable: opts.history.length === 0,
      indexedSources,
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

export async function completeAskWithTools(
  openai: OpenAI,
  messages: ChatCompletionMessageParam[],
  opts?: { allowTicketTable?: boolean; indexedSources?: AskIndexedSource[] }
): Promise<{ text: string; tools: string[] }> {
  const allowTicketTable = opts?.allowTicketTable ?? true;
  const indexedSources = opts?.indexedSources ?? [];
  const toolDefs = buildAskTools(indexedSources.map((item) => item.id));
  const sourceContext = { sources: indexedSources };
  const tools: string[] = [];
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
    if (!choice) return { text: "", tools };
    const calls = choice.tool_calls ?? [];
    if (calls.length === 0) {
      return { text: finalAskText(tools, lastDocument, choice.content, allowTicketTable), tools };
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
      const dispatched = await dispatchAskTool(call.function.name, raw, sourceContext);
      if (call.function.name === ASK_TOOL_DOCUMENT_BY_KEY) {
        lastDocument = parseDocumentByKeyResult(dispatched.result);
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: dispatched.result,
      });
    }
  }
  return { text: "", tools };
}

/**
 * First-turn ticket-only lookups use a Field | Value table from stored fields.
 * Follow-ups and mixed turns keep the model text so summaries and groupings are not dropped.
 */
function finalAskText(
  tools: string[],
  document: DocumentByKeyResult | null,
  content: string | null | undefined,
  allowTicketTable: boolean
): string {
  if (document && allowTicketTable && shouldFormatTicketTable(tools, true)) {
    return formatDocumentByKeyAnswer(document);
  }
  return (content ?? "").trim();
}
