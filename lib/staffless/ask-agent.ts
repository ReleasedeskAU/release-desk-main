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

const ASK_HISTORY_TURN_LIMIT = 16;

/**
 * Fixed follow-up example. Placed after prior turns, not in the system prompt:
 * the previous answer is what the model would otherwise copy a source from.
 */
export const ASK_FOLLOWUP_SOURCE_EXAMPLE = [
  "Follow-up source scope. Earlier turns do not set source.",
  "User: What happened recently in Teams?",
  "→ source=teams, because this question names Teams.",
  "User: Who's working on the release stuff?",
  "→ This question names no source. Call a tool with source omitted or source=all. Do not pass source=teams. Do not answer from the previous reply.",
  "User: What about Slack?",
  "→ source=slack, because this question names Slack.",
].join("\n");

/**
 * Assemble the Ask messages for one turn.
 * A follow-up example is inserted only when this tab already has history, after
 * those turns and before the current question. First turns are system + question.
 * @param system - System prompt, including this turn's source inventory.
 * @param history - Prior user/assistant text. Tool traces are not included.
 * @param message - Current user question.
 * @returns System, optional history, optional follow-up example, then the question.
 */
export function buildAskMessages(opts: {
  system: string;
  history: readonly AskHistoryTurn[];
  message: string;
}): ChatCompletionMessageParam[] {
  const history = opts.history.slice(-ASK_HISTORY_TURN_LIMIT).map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));
  const messages: ChatCompletionMessageParam[] = [{ role: "system", content: opts.system }, ...history];
  if (history.length > 0) {
    messages.push({ role: "system", content: ASK_FOLLOWUP_SOURCE_EXAMPLE });
  }
  messages.push({ role: "user", content: opts.message });
  return messages;
}

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
  const messages = buildAskMessages({
    system: `${ASK_AGENT_SYSTEM}\n\n${formatAskSourceInventory(indexedSources)}`,
    history: opts.history,
    message: opts.message,
  });

  try {
    let streamed = false;
    const outcome = yield* eventsWhile((push) =>
      completeAskWithTools(openai, messages, {
        indexedSources,
        userQuestion: opts.message,
        onAnswerStart: (toolNames) => {
          push({ type: "status", phase: "answering" });
          const grounding = askGroundingFromTools(toolNames);
          if (grounding) push({ type: "grounding", kind: grounding });
        },
        onAnswerDelta: (delta) => {
          streamed = true;
          push({ type: "text", text: delta });
        },
      })
    );
    logger.info("ask.agent_tools", { tools: outcome.tools, n: outcome.tools.length });
    yield* yieldAskOutcome(outcome, streamed);
  } catch (err) {
    logger.error("ask.agent_failed", { kind: err instanceof Error ? err.name : "unknown" });
    yield { type: "error", message: ASK_PUBLIC_UNAVAILABLE };
    yield { type: "done" };
  }
}

/** Table rewrites and empty streams still use one text event. Deltas already sent are not repeated. */
async function* yieldAskOutcome(outcome: AskToolLoopResult, streamed: boolean): AsyncGenerator<AskEvent> {
  if (!outcome.text) {
    if (!streamed) yield { type: "status", phase: "answering" };
    yield { type: "error", message: ASK_PUBLIC_UNAVAILABLE };
    yield { type: "done" };
    return;
  }
  if (!streamed) {
    yield { type: "status", phase: "answering" };
    const grounding = askGroundingFromTools(outcome.tools);
    if (grounding) yield { type: "grounding", kind: grounding };
  }
  if (outcome.sources.length > 0) yield { type: "sources", sources: outcome.sources };
  if (!streamed) yield { type: "text", text: outcome.text };
  yield { type: "done" };
}

async function loadAskIndexedSources(): Promise<AskIndexedSource[]> {
  try {
    return uniqueAskSources(await listStafflessConnectors());
  } catch (err) {
    logger.warn("ask.sources_unavailable", { kind: err instanceof Error ? err.name : "unknown" });
    return [];
  }
}

type AssembledToolCall = { id: string; name: string; arguments: string };

type AssembledTurn = { content: string; toolCalls: AssembledToolCall[] };

type AnswerStreamHooks = {
  /** False when a table rewrite will replace the prose, so raw tokens must not be shown. */
  allowDeltas: boolean;
  onStart?: () => void;
  onDelta?: (delta: string) => void;
};

type StreamToolDelta = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

type StreamChunk = {
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: StreamToolDelta[] };
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
};

/**
 * Yield events pushed while `produce` is still running.
 * Ask has to enqueue each text delta before the next model token, or the client still sees one burst.
 * @param produce - Work that pushes events and resolves to a result.
 * @returns The produce result after its events have been yielded.
 */
async function* eventsWhile<T>(
  produce: (push: (event: AskEvent) => void) => Promise<T>
): AsyncGenerator<AskEvent, T> {
  const queue: AskEvent[] = [];
  let wake: (() => void) | null = null;
  let settled = false;
  let result!: T;
  let failure: unknown;
  const poke = () => {
    const resolve = wake;
    wake = null;
    resolve?.();
  };
  const task = produce((event) => {
    queue.push(event);
    poke();
  }).then(
    (value) => {
      result = value;
      settled = true;
      poke();
    },
    (err: unknown) => {
      failure = err;
      settled = true;
      poke();
    }
  );
  try {
    while (!settled || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          if (settled || queue.length > 0) {
            resolve();
            return;
          }
          wake = resolve;
        });
        continue;
      }
      yield queue.shift() as AskEvent;
    }
  } finally {
    await task;
  }
  if (failure) throw failure;
  return result;
}

/**
 * Buffer edge whitespace so concatenated deltas equal `trim(raw)`.
 * Eval scores the trimmed string; the UI only has the deltas.
 */
function createTrimEmitter(hooks: AnswerStreamHooks): { push: (chunk: string) => void } {
  let started = false;
  let pending = "";
  let announced = false;
  return {
    push(chunk: string) {
      pending += chunk;
      if (!started) {
        pending = pending.trimStart();
        if (!pending) return;
        started = true;
      }
      const trailing = pending.match(/\s+$/);
      const keep = trailing?.[0].length ?? 0;
      const visible = pending.slice(0, pending.length - keep);
      pending = pending.slice(visible.length);
      if (!visible) return;
      if (!announced) {
        announced = true;
        hooks.onStart?.();
      }
      hooks.onDelta?.(visible);
    },
  };
}

function isAsyncIterable(value: unknown): value is AsyncIterable<StreamChunk> {
  return Boolean(value && typeof value === "object" && Symbol.asyncIterator in value);
}

function absorbToolDelta(
  calls: Map<number, AssembledToolCall>,
  delta: StreamToolDelta
): void {
  const index = delta.index ?? 0;
  const slot = calls.get(index) ?? { id: "", name: "", arguments: "" };
  if (delta.id) slot.id = delta.id;
  if (delta.function?.name) slot.name += delta.function.name;
  if (delta.function?.arguments) slot.arguments += delta.function.arguments;
  calls.set(index, slot);
}

function orderedToolCalls(calls: Map<number, AssembledToolCall>): AssembledToolCall[] {
  return [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, slot], index) => ({
      id: slot.id || `call_${index}`,
      name: slot.name,
      arguments: slot.arguments,
    }))
    .filter((call) => call.name.length > 0);
}

/**
 * Read one streamed completion. Tool-call rounds emit no answer text.
 * This API sends tool_calls before content, so the first tool delta locks the round.
 */
async function readStreamTurn(
  stream: AsyncIterable<StreamChunk>,
  hooks: AnswerStreamHooks
): Promise<AssembledTurn> {
  const calls = new Map<number, AssembledToolCall>();
  let content = "";
  let sawTool = false;
  const emit = hooks.allowDeltas ? createTrimEmitter(hooks) : null;
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.tool_calls?.length) {
      sawTool = true;
      for (const toolDelta of delta.tool_calls) absorbToolDelta(calls, toolDelta);
    }
    const piece = typeof delta?.content === "string" ? delta.content : "";
    if (!piece || sawTool) continue;
    content += piece;
    emit?.push(piece);
  }
  return { content, toolCalls: orderedToolCalls(calls) };
}

function turnFromMessage(
  message: NonNullable<StreamChunk["choices"]>[number]["message"]
): AssembledTurn | null {
  if (!message) return null;
  const toolCalls = (message.tool_calls ?? []).flatMap((call, index) => {
    if (call.type && call.type !== "function") return [];
    if (!call.function?.name) return [];
    return [
      {
        id: call.id || `call_${index}`,
        name: call.function.name,
        arguments: call.function.arguments ?? "",
      },
    ];
  });
  return { content: message.content ?? "", toolCalls };
}

async function readModelTurn(created: unknown, hooks: AnswerStreamHooks): Promise<AssembledTurn | null> {
  if (isAsyncIterable(created)) return readStreamTurn(created, hooks);
  if (!created || typeof created !== "object" || !("choices" in created)) return null;
  const message = (created as StreamChunk).choices?.[0]?.message;
  const turn = turnFromMessage(message);
  if (!turn) return null;
  if (turn.toolCalls.length === 0 && hooks.allowDeltas) createTrimEmitter(hooks).push(turn.content);
  return turn;
}

async function requestModelTurn(
  openai: OpenAI,
  messages: ChatCompletionMessageParam[],
  toolDefs: ReturnType<typeof buildAskTools>,
  hooks: AnswerStreamHooks
): Promise<AssembledTurn | null> {
  return readModelTurn(
    await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: toolDefs,
      tool_choice: "auto",
      temperature: 0.2,
      max_tokens: 1600,
      stream: true,
    }),
    hooks
  );
}

function assistantMessage(turn: AssembledTurn): ChatCompletionMessageParam {
  return {
    role: "assistant",
    content: turn.content || null,
    tool_calls: turn.toolCalls.map((call) => ({
      id: call.id,
      type: "function" as const,
      function: { name: call.name, arguments: call.arguments },
    })),
  };
}

/**
 * Run the Ask tool loop. Extra `calls` traces are for eval; production ignores them.
 * The completion is streamed. Returned `text` is still `finalAskText` — deltas, when emitted, concatenate to that string.
 * @param openai - OpenAI client (gpt-4o, temperature 0.2).
 * @param messages - System + history + current user question. Tool rounds append to this array.
 * @param opts - Indexed sources, question, optional dispatch override, optional answer-delta hooks.
 * @returns Final text, tool names, source chips, and per-call traces. Throws if the completion call throws.
 */
export async function completeAskWithTools(
  openai: OpenAI,
  messages: ChatCompletionMessageParam[],
  opts?: {
    indexedSources?: AskIndexedSource[];
    userQuestion?: string;
    dispatchTool?: AskToolDispatcher;
    onAnswerStart?: (tools: string[]) => void;
    onAnswerDelta?: (delta: string) => void;
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
  const limits: AskTurnLimits = { documentContentCalls: 0 };
  let lastDocument: DocumentByKeyResult | null = null;
  for (let round = 0; round < ASK_MAX_TOOL_ROUNDS; round += 1) {
    const turn = await requestModelTurn(openai, messages, toolDefs, {
      allowDeltas: !shouldFormatTicketTable(tools, question),
      onStart: () => opts?.onAnswerStart?.(tools),
      onDelta: opts?.onAnswerDelta,
    });
    if (!turn) {
      return { text: "", tools, sources: selectAskSourceChips("", batches), calls: recorded };
    }
    if (turn.toolCalls.length === 0) {
      const text = finalAskText(tools, lastDocument, turn.content, question);
      return { text, tools, sources: selectAskSourceChips(text, batches), calls: recorded };
    }
    lastDocument = await applyAssembledTools(turn, round + 1, {
      messages,
      tools,
      batches,
      recorded,
      limits,
      sourceContext,
      dispatchTool,
      userQuestion: opts?.userQuestion,
      lastDocument,
    });
  }
  return { text: "", tools, sources: selectAskSourceChips("", batches), calls: recorded };
}

async function applyAssembledTools(
  turn: AssembledTurn,
  round: number,
  state: {
    messages: ChatCompletionMessageParam[];
    tools: string[];
    batches: AskSourceBatch[];
    recorded: AskToolTraceCall[];
    limits: AskTurnLimits;
    sourceContext: AskSourceContext;
    dispatchTool: AskToolDispatcher;
    userQuestion?: string;
    lastDocument: DocumentByKeyResult | null;
  }
): Promise<DocumentByKeyResult | null> {
  state.messages.push(assistantMessage(turn));
  let lastDocument = state.lastDocument;
  for (const call of turn.toolCalls) {
    state.tools.push(call.name);
    const raw = parseToolArguments(call.arguments);
    const dispatched = await state.dispatchTool(
      call.name,
      raw,
      state.limits,
      state.sourceContext,
      state.userQuestion
    );
    state.recorded.push({ round, name: call.name, arguments: raw, result: dispatched.result });
    if (call.name === ASK_TOOL_DOCUMENT_BY_KEY) {
      lastDocument = parseDocumentByKeyResult(dispatched.result);
    }
    state.batches.push({
      tool: call.name,
      sources: sourcesToAttachFromTool(call.name, dispatched.result),
    });
    state.messages.push({ role: "tool", tool_call_id: call.id, content: dispatched.result });
  }
  return lastDocument;
}

function parseToolArguments(rawArgs: string): unknown {
  try {
    return JSON.parse(rawArgs || "{}") as unknown;
  } catch {
    return {};
  }
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
