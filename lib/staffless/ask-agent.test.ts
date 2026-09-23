import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type OpenAI from "openai";
import { ASK_FOLLOWUP_SOURCE_EXAMPLE, buildAskMessages, completeAskWithTools } from "./ask-agent";

type FakeStep = {
  content?: string | null;
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
};

function completionMessage(step: FakeStep) {
  return {
    choices: [
      {
        message: {
          content: step.content ?? null,
          tool_calls: (step.tool_calls ?? []).map((call) => ({
            type: "function" as const,
            id: call.id,
            function: { name: call.name, arguments: call.arguments },
          })),
        },
      },
    ],
  };
}

/** Split a scripted step into the same token/tool fragments a streamed completion sends. */
async function* streamStep(step: FakeStep): AsyncGenerator<unknown> {
  const calls = step.tool_calls ?? [];
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index]!;
    yield {
      choices: [
        {
          delta: {
            tool_calls: [{ index, id: call.id, function: { name: call.name, arguments: "" } }],
          },
        },
      ],
    };
    const args = call.arguments;
    for (let i = 0; i < args.length; i += 4) {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [{ index, function: { arguments: args.slice(i, i + 4) } }],
            },
          },
        ],
      };
    }
  }
  if (calls.length > 0) {
    if (step.content) yield { choices: [{ delta: { content: step.content } }] };
    return;
  }
  const text = step.content ?? "";
  if (!text) {
    yield { choices: [{ delta: {} }] };
    return;
  }
  for (let i = 0; i < text.length; i += 3) {
    yield { choices: [{ delta: { content: text.slice(i, i + 3) } }] };
  }
}

function fakeOpenAI(steps: FakeStep[], mode: "stream" | "message" = "stream"): OpenAI {
  let i = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const step = steps[i] ?? { content: "" };
          i += 1;
          return mode === "stream" ? streamStep(step) : completionMessage(step);
        },
      },
    },
  } as unknown as OpenAI;
}

describe("completeAskWithTools traces", () => {
  it("records tool name, arguments, and result in call order", async () => {
    const openai = fakeOpenAI([
      {
        tool_calls: [
          { id: "c1", name: "get_document_by_key", arguments: '{"key":"BN-378"}' },
        ],
      },
      { content: "BN-378 is a task." },
    ]);
    const out = await completeAskWithTools(
      openai,
      [{ role: "user", content: "what is BN-378 about" }],
      {
        userQuestion: "what is BN-378 about",
        dispatchTool: async (name) => ({
          name,
          result: JSON.stringify({
            found: true,
            key: "BN-378",
            title: "BN-378: Ask Retrieval Quality",
            link: "https://releasedesk-team.atlassian.net/browse/BN-378",
          }),
        }),
      }
    );
    assert.equal(out.tools.join(","), "get_document_by_key");
    assert.equal(out.calls.length, 1);
    assert.equal(out.calls[0]?.name, "get_document_by_key");
    assert.deepEqual(out.calls[0]?.arguments, { key: "BN-378" });
    assert.match(out.calls[0]?.result ?? "", /BN-378/);
    assert.equal(out.text, "BN-378 is a task.");
    assert.equal(out.text.includes("| Field | Value |"), false);
  });

  it("forces a Field|Value table only when the user asked for fields", async () => {
    const openai = fakeOpenAI([
      {
        tool_calls: [
          { id: "c1", name: "get_document_by_key", arguments: '{"key":"BN-378"}' },
        ],
      },
      { content: "BN-378 is a task." },
    ]);
    const out = await completeAskWithTools(
      openai,
      [{ role: "user", content: "show the fields for BN-378 as a table" }],
      {
        userQuestion: "show the fields for BN-378 as a table",
        dispatchTool: async (name) => ({
          name,
          result: JSON.stringify({
            found: true,
            key: "BN-378",
            title: "BN-378: Ask Retrieval Quality",
            link: "https://releasedesk-team.atlassian.net/browse/BN-378",
            fields: { status: "To Do" },
          }),
        }),
      }
    );
    assert.match(out.text, /\| Field \| Value \|/);
    assert.match(out.text, /BN-378/);
  });

  it("returns empty calls when the model answers without tools", async () => {
    const openai = fakeOpenAI([{ content: "I need a lookup." }]);
    const out = await completeAskWithTools(openai, [{ role: "user", content: "hi" }], {
      dispatchTool: async () => {
        throw new Error("dispatch must not run");
      },
    });
    assert.equal(out.calls.length, 0);
    assert.equal(out.tools.length, 0);
    assert.equal(out.text, "I need a lookup.");
  });

  it("emits more than one answer delta and concatenates to the scored text", async () => {
    const deltas: string[] = [];
    let starts = 0;
    const openai = fakeOpenAI([
      {
        content: "not the answer",
        tool_calls: [
          { id: "c1", name: "get_document_by_key", arguments: '{"key":"BN-378"}' },
        ],
      },
      { content: "  BN-378 is a task.  " },
    ]);
    const out = await completeAskWithTools(
      openai,
      [{ role: "user", content: "what is BN-378 about" }],
      {
        userQuestion: "what is BN-378 about",
        onAnswerStart: () => {
          starts += 1;
        },
        onAnswerDelta: (delta) => deltas.push(delta),
        dispatchTool: async (name) => ({
          name,
          result: JSON.stringify({ found: true, key: "BN-378" }),
        }),
      }
    );
    assert.equal(starts, 1);
    assert.ok(deltas.length > 1);
    assert.equal(deltas.join(""), "BN-378 is a task.");
    assert.equal(out.text, deltas.join(""));
    assert.equal(out.tools.join(","), "get_document_by_key");
    assert.deepEqual(out.calls[0]?.arguments, { key: "BN-378" });
  });

  it("does not stream tokens that a field table will replace", async () => {
    const deltas: string[] = [];
    const openai = fakeOpenAI([
      {
        tool_calls: [
          { id: "c1", name: "get_document_by_key", arguments: '{"key":"BN-378"}' },
        ],
      },
      { content: "BN-378 is a task." },
    ]);
    const out = await completeAskWithTools(
      openai,
      [{ role: "user", content: "show the fields for BN-378 as a table" }],
      {
        userQuestion: "show the fields for BN-378 as a table",
        onAnswerDelta: (delta) => deltas.push(delta),
        dispatchTool: async (name) => ({
          name,
          result: JSON.stringify({
            found: true,
            key: "BN-378",
            title: "BN-378: Ask Retrieval Quality",
            link: "https://releasedesk-team.atlassian.net/browse/BN-378",
            fields: { status: "To Do" },
          }),
        }),
      }
    );
    assert.equal(deltas.length, 0);
    assert.match(out.text, /\| Field \| Value \|/);
  });

  it("accepts a non-stream completion and still returns the trimmed text", async () => {
    const deltas: string[] = [];
    const openai = fakeOpenAI([{ content: "  hello  " }], "message");
    const out = await completeAskWithTools(openai, [{ role: "user", content: "hi" }], {
      onAnswerDelta: (delta) => deltas.push(delta),
      dispatchTool: async () => {
        throw new Error("dispatch must not run");
      },
    });
    assert.equal(deltas.join(""), "hello");
    assert.equal(out.text, "hello");
    assert.equal(out.calls.length, 0);
  });
});

describe("buildAskMessages", () => {
  it("leaves a first turn as system plus the question", () => {
    const messages = buildAskMessages({
      system: "rules",
      history: [],
      message: "How many PRs are closed?",
    });
    assert.deepEqual(
      messages.map((row) => row.role),
      ["system", "user"]
    );
    assert.equal(messages.some((row) => row.content === ASK_FOLLOWUP_SOURCE_EXAMPLE), false);
  });

  it("places the follow-up example after history and before the current question", () => {
    const messages = buildAskMessages({
      system: "rules",
      history: [
        { role: "user", content: "What happened recently in Teams?" },
        { role: "assistant", content: "Release 36.2 was announced in Teams." },
      ],
      message: "Who's working on the release stuff?",
    });
    assert.deepEqual(
      messages.map((row) => row.role),
      ["system", "user", "assistant", "system", "user"]
    );
    assert.equal(messages[3]?.content, ASK_FOLLOWUP_SOURCE_EXAMPLE);
    assert.equal(messages[4]?.content, "Who's working on the release stuff?");
    assert.match(ASK_FOLLOWUP_SOURCE_EXAMPLE, /source=teams/);
    assert.match(ASK_FOLLOWUP_SOURCE_EXAMPLE, /source omitted or source=all/);
    assert.match(ASK_FOLLOWUP_SOURCE_EXAMPLE, /source=slack/);
  });
});
