import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type OpenAI from "openai";
import { completeAskWithTools } from "./ask-agent";

function fakeOpenAI(
  steps: Array<{
    content?: string | null;
    tool_calls?: Array<{ id: string; name: string; arguments: string }>;
  }>
): OpenAI {
  let i = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const step = steps[i] ?? { content: "" };
          i += 1;
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
});
