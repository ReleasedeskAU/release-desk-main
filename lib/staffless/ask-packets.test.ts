import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as askCopy from "./ask-copy";
import { ASK_ADDITIONAL_CONTEXT, ASK_PUBLIC_UNAVAILABLE } from "./ask-copy";
import {
  applyCitation,
  buildSendChatMessageBody,
  mapStafflessLineToAskEvents,
  mapStafflessPacket,
  mergeAskSources,
  safeHttpUrl,
  selectAskSourceChips,
  askSourceDisplayTitle,
  sourcesFromAskToolResult,
  sourcesToAttachFromTool,
  STAFFLESS_CREATE_SESSION_PATH,
  STAFFLESS_SEND_CHAT_PATH,
} from "./ask-packets";
import { askBodySchema } from "./ask-schema";

describe("buildSendChatMessageBody", () => {
  it("targets the live send-chat-message shape without real_time", () => {
    const body = buildSendChatMessageBody("What is RD-1?", "11111111-1111-4111-8111-111111111111");
    assert.equal(body.stream, true);
    assert.equal(body.include_citations, false);
    assert.equal(body.deep_research, false);
    assert.equal(body.parent_message_id, -1);
    assert.equal(body.chat_session_id, "11111111-1111-4111-8111-111111111111");
    assert.ok(!("retrieval_options" in body));
    assert.ok(!("origin" in body));
    assert.equal(body.additional_context, ASK_ADDITIONAL_CONTEXT);
  });

  it("accepts injected additional_context override", () => {
    const extra = `${ASK_ADDITIONAL_CONTEXT}\n\nINDEX TOTALS are unused; counts come from get_verified_count.`;
    const body = buildSendChatMessageBody(
      "What is RD-1?",
      "11111111-1111-4111-8111-111111111111",
      extra
    );
    assert.equal(body.additional_context, extra);
  });

  it("calls the live StaffLess chat paths", () => {
    assert.equal(STAFFLESS_SEND_CHAT_PATH, "/api/chat/send-chat-message");
    assert.equal(STAFFLESS_CREATE_SESSION_PATH, "/api/chat/create-chat-session");
  });
});

describe("mapStafflessLineToAskEvents", () => {
  it("streams message deltas from Packet.obj", () => {
    const events = mapStafflessLineToAskEvents(
      JSON.stringify({
        placement: { turn_index: 0 },
        obj: { type: "message_delta", content: "Hello" },
      })
    );
    assert.deepEqual(events, [{ type: "text", text: "Hello" }]);
  });

  it("maps retrieved documents and ignores heartbeats", () => {
    const docs = mapStafflessLineToAskEvents(
      JSON.stringify({
        obj: {
          type: "search_tool_documents_delta",
          documents: [
            {
              document_id: "jira/RD-12",
              semantic_identifier: "RD-12: Fix login timeout",
              source_type: "jira",
              link: "https://example.atlassian.net/browse/RD-12",
            },
          ],
        },
      })
    );
    assert.equal(docs[0]?.type, "sources");
    if (docs[0]?.type !== "sources") throw new Error("expected sources");
    assert.equal(docs[0].sources[0]?.title, "RD-12: Fix login timeout");
    assert.equal(docs[0].sources[0]?.source, "Jira");
    assert.equal(docs[0].sources[0]?.url, "https://example.atlassian.net/browse/RD-12");
    assert.deepEqual(mapStafflessLineToAskEvents('{"obj":{"type":"chat_heartbeat"}}'), []);
  });

  it("maps empty document lists so the UI can show a limited-index hint", () => {
    const events = mapStafflessPacket({
      obj: { type: "search_tool_documents_delta", documents: [] },
    });
    assert.deepEqual(events, [{ type: "sources", sources: [] }]);
  });

  it("does not forward upstream error text", () => {
    const fromObj = mapStafflessPacket({ obj: { type: "error", exception: "traceback secret" } });
    const fromYield = mapStafflessPacket({ error: "Internal stack /api/manage" });
    assert.deepEqual(fromObj, [{ type: "error", message: ASK_PUBLIC_UNAVAILABLE }]);
    assert.deepEqual(fromYield, [{ type: "error", message: ASK_PUBLIC_UNAVAILABLE }]);
    assert.ok(!JSON.stringify(fromObj).includes("traceback"));
    assert.ok(!JSON.stringify(fromYield).includes("/api/manage"));
  });

  it("skips malformed lines instead of throwing", () => {
    assert.deepEqual(mapStafflessLineToAskEvents("not-json"), []);
    assert.deepEqual(mapStafflessLineToAskEvents("  "), []);
  });
});

describe("applyCitation / safeHttpUrl", () => {
  it("attaches citation numbers and drops non-http links", () => {
    const sources = applyCitation(
      [{ id: "jira/RD-12", title: "RD-12", url: null, source: "Jira" }],
      { n: 1, documentId: "jira/RD-12" }
    );
    assert.equal(sources[0]?.citationNumber, 1);
    assert.equal(safeHttpUrl("https://ok.example/x"), "https://ok.example/x");
    assert.equal(safeHttpUrl("javascript:alert(1)"), null);
    assert.equal(safeHttpUrl("JIRA_RD-12"), null);
  });

  it("extracts http record links from Ask tool JSON and skips invented schemes", () => {
    const sources = sourcesFromAskToolResult(
      JSON.stringify({
        documents: [
          {
            id: "slack-1",
            title: "hello",
            source: "Slack",
            link: "https://releasedesk.slack.com/archives/C123/p1",
          },
          { id: "skip", title: "no url", source: "Slack" },
          { id: "bad", title: "xss", link: "javascript:alert(1)" },
        ],
      })
    );
    assert.equal(sources.length, 1);
    assert.equal(sources[0]?.url, "https://releasedesk.slack.com/archives/C123/p1");
    assert.equal(sources[0]?.id, "https://releasedesk.slack.com/archives/C123/p1");
    assert.equal(sources[0]?.source, "Slack");
    const merged = mergeAskSources(sources, sources);
    assert.equal(merged.length, 1);
  });

  it("does not attach ranked search hits as source chips", () => {
    const payload = JSON.stringify({
      documents: [
        {
          title: "BN-378: Ask Retrieval Quality",
          source: "jira",
          link: "https://example.atlassian.net/browse/BN-378",
        },
        {
          title: "Confluence connector: sync errors",
          source: "jira",
          link: "https://example.atlassian.net/browse/BN-2",
        },
      ],
    });
    assert.equal(sourcesFromAskToolResult(payload).length, 2);
    assert.equal(sourcesToAttachFromTool("search_indexed_documents", payload).length, 0);
    assert.equal(
      sourcesToAttachFromTool(
        "get_document_by_key",
        JSON.stringify({
          found: true,
          title: "BN-378: Ask Retrieval Quality",
          source: "jira",
          link: "https://example.atlassian.net/browse/BN-378",
        })
      ).length,
      1
    );
  });

  it("keeps two Slack posts that share a channel title but have different permalinks", () => {
    const sources = sourcesFromAskToolResult(
      JSON.stringify({
        documents: [
          {
            id: "Unknown in #social",
            key: "Unknown in #social",
            title: "Unknown in #social",
            source: "Slack",
            link: "https://releasedesk.slack.com/archives/C123/p111",
          },
          {
            id: "Unknown in #social",
            key: "Unknown in #social",
            title: "Unknown in #social",
            source: "Slack",
            link: "https://releasedesk.slack.com/archives/C123/p222",
          },
        ],
      })
    );
    assert.equal(sources.length, 2);
    assert.equal(sources[0]?.id, "https://releasedesk.slack.com/archives/C123/p111");
    assert.equal(sources[1]?.id, "https://releasedesk.slack.com/archives/C123/p222");
  });

  it("caps chips at 3, prefers cited URLs, else the latest list's first rows", () => {
    const docs = [1, 2, 3, 4].map((n) => ({
      title: `post ${n}`,
      source: "slack",
      link: `https://example.com/p${n}`,
    }));
    const batch = {
      tool: "list_documents_matching",
      sources: sourcesFromAskToolResult(JSON.stringify({ documents: docs })),
    };
    const fallback = selectAskSourceChips("no links here", [batch]);
    assert.equal(fallback.length, 3);
    assert.equal(fallback[0]?.url, "https://example.com/p1");
    assert.equal(fallback[2]?.url, "https://example.com/p3");
    const cited = selectAskSourceChips(
      "See [one](https://example.com/p4) and [two](https://example.com/p2).",
      [batch]
    );
    assert.equal(cited.length, 2);
    assert.equal(cited[0]?.url, "https://example.com/p4");
    assert.equal(cited[1]?.url, "https://example.com/p2");
  });

  it("replaces empty and Unknown Subject chip titles", () => {
    assert.equal(
      askSourceDisplayTitle("about Unknown Subject", "CH1", "Microsoft Teams"),
      "Microsoft Teams · CH1"
    );
    assert.equal(askSourceDisplayTitle("Unknown Subject", "", "Microsoft Teams"), "Teams conversation");
    assert.equal(askSourceDisplayTitle("hello", "k", "Slack"), "hello");
    const sources = sourcesFromAskToolResult(
      JSON.stringify({
        documents: [
          {
            title: "Unknown Subject",
            source: "teams",
            link: "https://teams.example/a",
          },
        ],
      })
    );
    assert.equal(sources[0]?.title, "Teams conversation");
    assert.equal(sources[0]?.source, "Microsoft Teams");
  });
});

describe("askBodySchema", () => {
  it("accepts a message and optional session UUID", () => {
    const ok = askBodySchema.parse({
      message: "  hello  ",
      sessionId: "22222222-2222-4222-8222-222222222222",
    });
    assert.equal(ok.message, "hello");
  });

  it("rejects empty, oversized, extra fields, and bad session ids", () => {
    assert.equal(askBodySchema.safeParse({ message: "" }).success, false);
    assert.equal(askBodySchema.safeParse({ message: "a".repeat(8001) }).success, false);
    assert.equal(askBodySchema.safeParse({ message: "hi", extra: true }).success, false);
    assert.equal(askBodySchema.safeParse({ message: "hi", sessionId: "not-a-uuid" }).success, false);
    assert.equal(
      askBodySchema.safeParse({ message: "hi", history: [{ role: "user", content: "x", extra: true }] }).success,
      false
    );
  });

  it("accepts prior turns as history", () => {
    const ok = askBodySchema.parse({
      message: "how many belong to Kabir",
      history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
    });
    assert.equal(ok.history?.length, 2);
  });
});

describe("Ask branding copy", () => {
  it("does not mention Onyx in user-facing or injected context", () => {
    for (const value of Object.values(askCopy)) {
      const text = Array.isArray(value) ? value.join("\n") : String(value);
      assert.equal(/onyx/i.test(text), false, text);
    }
  });
});
