import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALLOWED_COUNT_FIELDS, PII_TAG_FIELDS } from "./ask-count";
import {
  ASK_TOOL_BREAKDOWN,
  ASK_TOOL_DISTINCT,
  ASK_TOOL_DOCUMENT_BY_KEY,
  ASK_TOOL_GET_VERIFIED_COUNT,
  ASK_TOOL_LIST_MATCHING,
  ASK_TOOL_QUERYABLE_FIELDS,
  ASK_TOOL_INDEXED_SOURCES,
  ASK_TOOL_SEARCH_INDEX,
  ASK_TOOLS,
  buildAskTools,
  dispatchAskTool,
} from "./ask-tools";
import { ASK_AGENT_SYSTEM } from "./ask-copy";
import { ASK_MAX_TOOL_ROUNDS } from "./ask-agent";
import { ASK_NO_TOOL_HINT, ASK_PUBLIC_UNAVAILABLE, ASK_TOOL_FAILURE_HINT } from "./ask-errors";

const CATALOG_TOOLS = [
  ASK_TOOL_INDEXED_SOURCES,
  ASK_TOOL_GET_VERIFIED_COUNT,
  ASK_TOOL_BREAKDOWN,
  ASK_TOOL_DISTINCT,
  ASK_TOOL_DOCUMENT_BY_KEY,
  ASK_TOOL_LIST_MATCHING,
  ASK_TOOL_QUERYABLE_FIELDS,
  ASK_TOOL_SEARCH_INDEX,
];

describe("Ask catalog tools", () => {
  it("exposes eight distinct tools with non-overlapping jobs", () => {
    const names = ASK_TOOLS.map((t) => (t.type === "function" ? t.function.name : "")).sort();
    assert.deepEqual(names, [...CATALOG_TOOLS].sort());
    const byName = Object.fromEntries(
      ASK_TOOLS.filter((t) => t.type === "function").map((t) => [
        t.function.name,
        t.function.description ?? "",
      ])
    );
    assert.match(byName[ASK_TOOL_GET_VERIFIED_COUNT] ?? "", /AND filters/);
    assert.match(byName[ASK_TOOL_BREAKDOWN] ?? "", /grouped by one field/);
    assert.match(byName[ASK_TOOL_DISTINCT] ?? "", /stored values/);
    assert.match(byName[ASK_TOOL_DOCUMENT_BY_KEY] ?? "", /exact lookup/i);
    assert.match(byName[ASK_TOOL_LIST_MATCHING] ?? "", /AND filters/);
    assert.match(byName[ASK_TOOL_QUERYABLE_FIELDS] ?? "", /Published fields/);
    assert.match(byName[ASK_TOOL_SEARCH_INDEX] ?? "", /Ranked sample/);
    assert.match(byName[ASK_TOOL_SEARCH_INDEX] ?? "", /Never use for how-many/);
    assert.match(byName[ASK_TOOL_INDEXED_SOURCES] ?? "", /Created connector sources/);
    const live = buildAskTools(["bitbucket", "jira"]);
    const count = live.find((t) => t.type === "function" && t.function.name === ASK_TOOL_GET_VERIFIED_COUNT);
    const sourceEnum =
      count && count.type === "function"
        ? ((count.function.parameters as { properties?: { source?: { enum?: string[] } } })?.properties?.source
            ?.enum ?? [])
        : [];
    assert.deepEqual(sourceEnum, ["all", "bitbucket", "jira"]);
  });

  it("rejects unknown tools, extra args, and invalid fields without calling StaffLess", async () => {
    const unknown = await dispatchAskTool("drop_table", {});
    assert.match(unknown.result, /unknown_tool/);
    assert.match(unknown.result, /hint/);
    const extra = await dispatchAskTool(ASK_TOOL_BREAKDOWN, {
      field: "assignee",
      extra: true,
    });
    assert.match(extra.result, /invalid_args/);
    const badField = await dispatchAskTool(ASK_TOOL_DISTINCT, { field: "not_a_field" });
    assert.match(badField.result, /invalid_args/);
    const badKey = await dispatchAskTool(ASK_TOOL_DOCUMENT_BY_KEY, { key: "" });
    assert.match(badKey.result, /invalid_args/);
    const missingValue = await dispatchAskTool(ASK_TOOL_LIST_MATCHING, {
      filter_field: "labels",
    });
    assert.match(missingValue.result, /invalid_args/);
    const pii = await dispatchAskTool(ASK_TOOL_DISTINCT, { field: "assignee_email" });
    assert.match(pii.result, /invalid_args/);
    const listed = await dispatchAskTool(
      ASK_TOOL_INDEXED_SOURCES,
      {},
      { sources: [{ id: "bitbucket", label: "Bitbucket", docsIndexed: 1 }] }
    );
    assert.match(listed.result, /bitbucket/);
    const blocked = await dispatchAskTool(
      ASK_TOOL_GET_VERIFIED_COUNT,
      { source: "confluence" },
      { sources: [{ id: "jira", label: "Jira", docsIndexed: 2 }] }
    );
    assert.match(blocked.result, /unknown_source/);
  });

  it("allow-lists metadata fields and describes tool choice rather than phrases", () => {
    assert.ok(ALLOWED_COUNT_FIELDS.includes("assignee"));
    assert.ok(ALLOWED_COUNT_FIELDS.includes("status"));
    assert.ok(ALLOWED_COUNT_FIELDS.includes("status_category"));
    assert.ok(ALLOWED_COUNT_FIELDS.includes("parent"));
    assert.ok(ALLOWED_COUNT_FIELDS.includes("duedate"));
    assert.ok(ALLOWED_COUNT_FIELDS.includes("issuelink"));
    assert.ok(ALLOWED_COUNT_FIELDS.includes("last_updater"));
    assert.ok(ALLOWED_COUNT_FIELDS.includes("repo"));
    assert.ok(ALLOWED_COUNT_FIELDS.includes("object_type"));
    assert.ok(ALLOWED_COUNT_FIELDS.includes("num_files_changed"));
    assert.ok(ALLOWED_COUNT_FIELDS.includes("num_commits"));
    for (const blocked of PII_TAG_FIELDS) {
      assert.equal(
        (ALLOWED_COUNT_FIELDS as readonly string[]).includes(blocked),
        false,
        blocked
      );
    }
    assert.equal(ASK_MAX_TOOL_ROUNDS >= 4, true);
    assert.match(ASK_AGENT_SYSTEM, /choose by what the question needs/i);
    assert.match(ASK_AGENT_SYSTEM, /list_queryable_fields/);
    assert.match(ASK_AGENT_SYSTEM, /get_breakdown_by_field/);
    assert.match(ASK_AGENT_SYSTEM, /list_distinct_values/);
    assert.match(ASK_AGENT_SYSTEM, /list_documents_matching/);
    assert.match(ASK_AGENT_SYSTEM, /Date ranges/);
    assert.match(ASK_AGENT_SYSTEM, /due_before/);
    assert.match(ASK_AGENT_SYSTEM, /RD-9 is not RD-90/);
    assert.match(ASK_AGENT_SYSTEM, /get_document_by_key/);
    assert.match(ASK_AGENT_SYSTEM, /Field\|Value/);
    assert.match(ASK_AGENT_SYSTEM, /resolved_status_category/);
    assert.match(ASK_AGENT_SYSTEM, /status_category/);
    assert.equal(/resolved_statuses/.test(ASK_AGENT_SYSTEM), false);
    assert.match(ASK_AGENT_SYSTEM, /candidates, not confirmed duplicates/);
    assert.match(ASK_AGENT_SYSTEM, /title\/summary match/);
    assert.equal(/Q26|Q24|Q33/i.test(ASK_AGENT_SYSTEM), false);
    assert.match(ASK_AGENT_SYSTEM, /Never call that number "repos"/);
    assert.match(ASK_AGENT_SYSTEM, /num_files_changed/);
    assert.match(ASK_AGENT_SYSTEM, /list_indexed_sources/);
    assert.match(ASK_AGENT_SYSTEM, /Never claim a fixed vendor list/);
    const countTool = ASK_TOOLS.find((t) => t.type === "function" && t.function.name === ASK_TOOL_GET_VERIFIED_COUNT);
    assert.match(countTool && countTool.type === "function" ? countTool.function.description ?? "" : "", /not repositories/);
    assert.equal(/how many Jira tickets are indexed/i.test(ASK_AGENT_SYSTEM), false);
    assert.equal(/onyx/i.test(ASK_AGENT_SYSTEM), false);
  });

  it("returns ticket keys from list_documents_matching instead of a count-only payload", async () => {
    const originalFetch = globalThis.fetch;
    const originalPat = process.env.STAFFLESS_AI_PAT;
    const originalUrl = process.env.STAFFLESS_AI_URL;
    process.env.STAFFLESS_AI_PAT = "test-pat";
    process.env.STAFFLESS_AI_URL = "http://staffless.test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          count: 4,
          source: "jira",
          filter_field: "labels",
          filter_value: "release123",
          matched_values: ["release123"],
          documents: [
            { key: "RD-10", title: "RD-10: One", link: "https://example.test/RD-10" },
            { key: "RD-11", title: "RD-11: Two", link: "https://example.test/RD-11" },
          ],
          truncated: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;
    try {
      const result = await dispatchAskTool(ASK_TOOL_LIST_MATCHING, {
        source: "jira",
        filters: [
          { filter_field: "issuetype", filter_value: "Bug" },
          { filter_field: "assignee", filter_value: "Kabir" },
        ],
      });
      const payload = JSON.parse(result.result) as {
        count: number;
        documents: Array<{ key: string; assignee?: string | null }>;
      };
      assert.equal(payload.count, 4);
      assert.deepEqual(
        payload.documents.map((row) => row.key),
        ["RD-10", "RD-11"]
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalPat === undefined) delete process.env.STAFFLESS_AI_PAT;
      else process.env.STAFFLESS_AI_PAT = originalPat;
      if (originalUrl === undefined) delete process.env.STAFFLESS_AI_URL;
      else process.env.STAFFLESS_AI_URL = originalUrl;
    }
  });
});

describe("Ask date-range tools", () => {
  it("accepts due_before on count and rejects a non-ISO date", async () => {
    const originalFetch = globalThis.fetch;
    const originalPat = process.env.STAFFLESS_AI_PAT;
    const originalUrl = process.env.STAFFLESS_AI_URL;
    process.env.STAFFLESS_AI_PAT = "test-pat";
    process.env.STAFFLESS_AI_URL = "http://staffless.test";
    let sent: unknown;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ count: 7, source: "jira", filters: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const bad = await dispatchAskTool(ASK_TOOL_GET_VERIFIED_COUNT, { due_before: "tomorrow" });
      assert.match(bad.result, /invalid_args/);
      const ok = await dispatchAskTool(ASK_TOOL_GET_VERIFIED_COUNT, { due_before: "2026-09-05" });
      const payload = JSON.parse(ok.result) as { count: number };
      assert.equal(payload.count, 7);
      assert.equal((sent as { due_before?: string }).due_before, "2026-09-05");
      const github = await dispatchAskTool(ASK_TOOL_GET_VERIFIED_COUNT, { source: "github" });
      const githubPayload = JSON.parse(github.result) as { note?: string };
      assert.match(githubPayload.note ?? "", /not repositories/);
      const bitbucket = await dispatchAskTool(ASK_TOOL_GET_VERIFIED_COUNT, { source: "bitbucket" });
      assert.equal((sent as { source?: string }).source, "bitbucket");
      assert.equal(JSON.parse(bitbucket.result).count, 7);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalPat === undefined) delete process.env.STAFFLESS_AI_PAT;
      else process.env.STAFFLESS_AI_PAT = originalPat;
      if (originalUrl === undefined) delete process.env.STAFFLESS_AI_URL;
      else process.env.STAFFLESS_AI_URL = originalUrl;
    }
  });

  it("allows list_documents_matching with only a date range", async () => {
    const originalFetch = globalThis.fetch;
    const originalPat = process.env.STAFFLESS_AI_PAT;
    const originalUrl = process.env.STAFFLESS_AI_URL;
    process.env.STAFFLESS_AI_PAT = "test-pat";
    process.env.STAFFLESS_AI_URL = "http://staffless.test";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          count: 2,
          documents: [
            { key: "RD-28", title: "A", assignee: null, status: "To Do", duedate: "2026-08-01" },
          ],
          truncated: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;
    try {
      const missing = await dispatchAskTool(ASK_TOOL_LIST_MATCHING, {});
      assert.match(missing.result, /invalid_args/);
      const result = await dispatchAskTool(ASK_TOOL_LIST_MATCHING, {
        due_before: "2026-09-05",
        sort_by: "created_asc",
      });
      const payload = JSON.parse(result.result) as {
        documents: Array<{ key: string; assignee: string | null }>;
      };
      assert.equal(payload.documents[0]?.key, "RD-28");
      assert.equal(payload.documents[0]?.assignee, null);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalPat === undefined) delete process.env.STAFFLESS_AI_PAT;
      else process.env.STAFFLESS_AI_PAT = originalPat;
      if (originalUrl === undefined) delete process.env.STAFFLESS_AI_URL;
      else process.env.STAFFLESS_AI_URL = originalUrl;
    }
  });
});

describe("Ask graceful failures", () => {
  it("keeps user-facing failures plain and free of internals", () => {
    const blob = `${ASK_PUBLIC_UNAVAILABLE}\n${ASK_TOOL_FAILURE_HINT}\n${ASK_NO_TOOL_HINT}`;
    assert.match(ASK_PUBLIC_UNAVAILABLE, /exact counts and breakdowns/i);
    assert.match(ASK_NO_TOOL_HINT, /say clearly what they asked for/i);
    for (const banned of ["traceback", "exception", "stack", "openai", "onyx", "postgres", "ECONNREFUSED"]) {
      assert.equal(new RegExp(banned, "i").test(blob), false, banned);
    }
  });

  it("turns thrown StaffLess errors into a tool result instead of a raw exception", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:secret");
    }) as typeof fetch;
    try {
      const result = await dispatchAskTool(ASK_TOOL_BREAKDOWN, { field: "assignee", source: "jira" });
      assert.match(result.result, /tool_failed/);
      assert.match(result.result, /hint/);
      assert.equal(result.result.includes("ECONNREFUSED"), false);
      assert.equal(result.result.includes("127.0.0.1"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
