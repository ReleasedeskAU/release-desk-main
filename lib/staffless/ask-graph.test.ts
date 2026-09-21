/**
 * Stage 1 graph tests: stored-edge traversal over an injected fake catalog.
 * Fixtures encode the three approved eval scenarios with known answers —
 * blockers with a Relates distractor, a multi-seed closure with a shared
 * dependency and a body-mention tripwire, and children/subtasks parity.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  edgesFromStoredFields,
  getDependencyClosure,
  getLinkedWorkItems,
  normalizeGraphKey,
  parseEmbeddedLink,
  splitStoredValues,
  type GraphFetchers,
} from "./ask-graph";
import type { DocumentByKeyResult, DocumentListResult } from "./ask-catalog";
import {
  ASK_TOOL_DEPENDENCY_CLOSURE,
  ASK_TOOL_LINKED_ITEMS,
  dispatchAskTool,
} from "./ask-tools";

type ByKeyRow = { found: boolean; fields?: Record<string, string | string[]> };

function fakeFetchers(byKey: Record<string, ByKeyRow>, children: Record<string, string[]>): GraphFetchers {
  return {
    byKey: async ({ key }: { key: string }): Promise<DocumentByKeyResult> => {
      const row = byKey[key.toUpperCase()];
      if (!row?.found) {
        return { found: false, key, source: "jira", note: "No indexed document with this exact key." };
      }
      return { found: true, key, source: "jira", fields: row.fields, note: "ok" };
    },
    listMatching: async (args: { filter_value: string }): Promise<DocumentListResult> => {
      const keys = children[args.filter_value.toUpperCase()] ?? [];
      return {
        count: keys.length,
        returned: keys.length,
        cap: 50,
        source: "jira",
        filters: [],
        filter_field: "parent",
        filter_value: args.filter_value,
        matched_values: [args.filter_value],
        documents: keys.map((key) => ({
          document_id: `jira-${key.toLowerCase()}`,
          key,
          title: key,
          link: null,
        })),
        truncated: false,
        note: "ok",
      };
    },
  };
}

/** Eval scenario 1: RD-114 blocked by two tickets; RD-120 merely Relates. */
const BLOCKER_FIXTURE = fakeFetchers(
  {
    "RD-114": {
      found: true,
      fields: { issuelink: ["RD-101", "RD-107", "RD-120"], issuelink_type: ["Blocks", "Blocks", "Relates"] },
    },
    "RD-101": { found: true, fields: {} },
    "RD-107": { found: true, fields: {} },
    "RD-120": { found: true, fields: {} },
  },
  {}
);

/** Eval scenario 2: release-36.2 seeds share RD-301; RD-203 only mentions RD-999 in prose. */
const CLOSURE_FIXTURE = fakeFetchers(
  {
    "RD-201": { found: true, fields: { parent: "RD-300", issuelink: "RD-301", issuelink_type: "Blocks" } },
    "RD-202": { found: true, fields: { issuelink: "RD-301", issuelink_type: "Blocks" } },
    "RD-203": { found: true, fields: {} },
    "RD-300": { found: true, fields: { issuelink: "RD-302", issuelink_type: "Relates" } },
    "RD-301": { found: true, fields: {} },
    "RD-302": { found: true, fields: {} },
  },
  {}
);

describe("ask-graph stored-edge parsing", () => {
  it("pairs parallel issuelink/issuelink_type arrays and skips self-links", () => {
    const edges = edgesFromStoredFields(
      "RD-114",
      { issuelink: ["RD-101", "RD-114", "RD-120"], issuelink_type: ["Blocks", "Blocks", "Relates"] },
      1
    );
    assert.deepEqual(
      edges.map((e) => [e.to_key, e.link_kind]),
      [
        ["RD-101", "Blocks"],
        ["RD-120", "Relates"],
      ]
    );
    assert.ok(edges.every((e) => e.relation === "LINKS_TO"));
  });

  it("applies one stored kind to every link and never invents a missing kind", () => {
    const single = edgesFromStoredFields("RD-1", { issuelink: ["RD-2", "RD-3"], issuelink_type: "Blocks" }, 1);
    assert.ok(single.every((e) => e.link_kind === "Blocks"));
    const mismatched = edgesFromStoredFields(
      "RD-1",
      { issuelink: ["RD-2", "RD-3", "RD-4"], issuelink_type: ["Blocks", "Relates"] },
      1
    );
    assert.ok(mismatched.every((e) => e.link_kind === null));
  });

  it("splits delimited stored lists without re-interpreting prose", () => {
    assert.deepEqual(splitStoredValues("RD-1, RD-2;RD-3|RD-4\nRD-5"), ["RD-1", "RD-2", "RD-3", "RD-4", "RD-5"]);
    assert.deepEqual(splitStoredValues(["RD-1", 42, null]), ["RD-1"]);
    assert.deepEqual(splitStoredValues(undefined), []);
    assert.equal(normalizeGraphKey(" rd-9 "), "RD-9");
  });

  it("splits embedded kind:KEY links and leaves anything else verbatim", () => {
    assert.deepEqual(parseEmbeddedLink("blocks:BN-217"), { kind: "blocks", key: "BN-217" });
    assert.deepEqual(parseEmbeddedLink("Relates : RD-5"), { kind: "Relates", key: "RD-5" });
    assert.equal(parseEmbeddedLink("RD-7"), null);
    assert.equal(parseEmbeddedLink("https://example.test/browse/BN-1"), null);
    assert.equal(parseEmbeddedLink("not a link"), null);
    const edges = edgesFromStoredFields("BN-215", { issuelink: "blocks:BN-217", issuelink_type: "blocks" }, 1);
    assert.deepEqual(
      edges.map((e) => [e.to_key, e.link_kind]),
      [["BN-217", "blocks"]]
    );
  });
});

describe("ask-graph eval scenario 1: blockers with a Relates distractor", () => {
  it("returns exactly the two blocking keys, never the Relates neighbor", async () => {
    const out = await getLinkedWorkItems(
      { source: "jira", key: "RD-114", relation: "linked", link_kind: "Blocks", depth: 1 },
      BLOCKER_FIXTURE
    );
    assert.deepEqual(out.related_keys.sort(), ["RD-101", "RD-107"]);
    assert.ok(out.edges.every((e) => e.link_kind === "Blocks"));
    assert.ok(!out.edges.some((e) => normalizeGraphKey(e.to_key) === "RD-120"));
    assert.equal(out.truncated, false);
  });

  it("reports both relations when no link_kind filter is given", async () => {
    const out = await getLinkedWorkItems({ source: "jira", key: "RD-114" }, BLOCKER_FIXTURE);
    assert.deepEqual(out.related_keys.sort(), ["RD-101", "RD-107", "RD-120"]);
  });
});

describe("ask-graph eval scenario 2: release closure", () => {
  it("dedupes the shared dependency and ignores the prose mention", async () => {
    const out = await getDependencyClosure(
      { source: "jira", keys: ["RD-201", "RD-202", "RD-203"], direction: "upstream", depth: 2 },
      CLOSURE_FIXTURE
    );
    assert.deepEqual(out.related_keys.sort(), ["RD-300", "RD-301", "RD-302"]);
    const toKeys = out.edges.map((e) => normalizeGraphKey(e.to_key));
    assert.equal(toKeys.filter((k) => k === "RD-301").length, 2);
    assert.ok(!toKeys.includes("RD-999"));
    assert.ok(!out.related_keys.includes("RD-999"));
  });

  it("downstream lists children instead of climbing to parents", async () => {
    const fetchers = fakeFetchers({ "RD-201": { found: true, fields: { parent: "RD-300" } } }, { "RD-201": ["RD-210"] });
    const out = await getDependencyClosure(
      { source: "jira", keys: ["RD-201"], direction: "downstream", depth: 1 },
      fetchers
    );
    assert.deepEqual(out.related_keys, ["RD-210"]);
  });
});

describe("ask-graph eval scenario 3: children parity with the catalog", () => {
  it("returns the same child set as list filter parent=", async () => {
    const fetchers = fakeFetchers(
      { "BN-15": { found: true, fields: {} }, "BN-16": { found: true, fields: {} }, "BN-17": { found: true, fields: {} } },
      { "BN-15": ["BN-16", "BN-17"] }
    );
    const out = await getLinkedWorkItems({ source: "jira", key: "BN-15", relation: "children" }, fetchers);
    assert.deepEqual(out.related_keys.sort(), ["BN-16", "BN-17"]);
    assert.ok(out.edges.every((e) => e.relation === "CHILD_OF"));
  });

  it("follows parent_chain upward one key at a time", async () => {
    const fetchers = fakeFetchers(
      {
        "RD-201": { found: true, fields: { parent: "RD-300" } },
        "RD-300": { found: true, fields: { parent: "RD-400" } },
        "RD-400": { found: true, fields: {} },
      },
      {}
    );
    const one = await getLinkedWorkItems({ source: "jira", key: "RD-201", relation: "parent_chain", depth: 1 }, fetchers);
    assert.deepEqual(one.related_keys, ["RD-300"]);
    const two = await getLinkedWorkItems({ source: "jira", key: "RD-201", relation: "parent_chain", depth: 2 }, fetchers);
    assert.deepEqual(two.related_keys.sort(), ["RD-300", "RD-400"]);
  });
});

describe("ask-graph safety rails", () => {
  it("terminates cycles and caps seeds, depth, and visited keys", async () => {
    const fetchers = fakeFetchers(
      {
        "RD-401": { found: true, fields: { issuelink: "RD-402", issuelink_type: "Relates" } },
        "RD-402": { found: true, fields: { issuelink: "RD-401", issuelink_type: "Relates" } },
      },
      {}
    );
    const out = await getLinkedWorkItems({ source: "jira", key: "RD-401", depth: 3 }, fetchers);
    assert.deepEqual(out.related_keys, ["RD-402"]);
    assert.equal(out.edges.length, 2);

    const many = await getDependencyClosure(
      { source: "jira", keys: Array.from({ length: 20 }, (_, i) => `RD-${i}`), depth: 9 as unknown as 3 },
      CLOSURE_FIXTURE
    );
    assert.ok(many.seeds.length <= 10);
  });

  it("says not-in-index for an unresolved seed instead of substituting", async () => {
    const out = await getLinkedWorkItems({ source: "jira", key: "RD-999999" }, BLOCKER_FIXTURE);
    assert.deepEqual(out.edges, []);
    assert.deepEqual(out.related_keys, []);
    assert.match(out.note, /No indexed document with this exact key/);
  });

  it("marks truncation when a child list is capped", async () => {
    const fetchers: GraphFetchers = {
      ...BLOCKER_FIXTURE,
      listMatching: async (): Promise<DocumentListResult> => ({
        count: 51,
        returned: 1,
        cap: 50,
        source: "jira",
        filters: [],
        filter_field: "parent",
        filter_value: "RD-9",
        matched_values: ["RD-9"],
        documents: [{ document_id: "jira-rd-10", key: "RD-10", title: "RD-10", link: null }],
        truncated: true,
        note: "capped",
      }),
    };
    const out = await getLinkedWorkItems({ source: "jira", key: "RD-9", relation: "children" }, fetchers);
    assert.equal(out.truncated, true);
    assert.deepEqual(out.related_keys, ["RD-10"]);
  });
});

describe("ask-graph tool dispatch", () => {
  function mockCatalogFetch(fixture: Record<string, ByKeyRow>, children: Record<string, string[]>) {
    const originalFetch = globalThis.fetch;
    const savedPat = process.env.STAFFLESS_AI_PAT;
    const savedUrl = process.env.STAFFLESS_AI_URL;
    process.env.STAFFLESS_AI_PAT = "test-pat";
    process.env.STAFFLESS_AI_URL = "http://staffless.test";
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      const href = String(url);
      const body = JSON.parse(String(init?.body ?? "{}")) as { key?: string; filter_value?: string };
      if (href.includes("document-by-key")) {
        const row = fixture[body.key?.toUpperCase() ?? ""];
        return new Response(
          JSON.stringify(
            row?.found
              ? { found: true, key: body.key, source: "jira", fields: row.fields, note: "ok" }
              : { found: false, key: body.key, source: "jira", note: "missing" }
          ),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      const keys = children[body.filter_value?.toUpperCase() ?? ""] ?? [];
      return new Response(
        JSON.stringify({
          count: keys.length,
          source: "jira",
          filters: [],
          documents: keys.map((key) => ({ document_id: `jira-${key.toLowerCase()}`, key, title: key, link: null })),
          truncated: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    return () => {
      globalThis.fetch = originalFetch;
      if (savedPat === undefined) delete process.env.STAFFLESS_AI_PAT;
      else process.env.STAFFLESS_AI_PAT = savedPat;
      if (savedUrl === undefined) delete process.env.STAFFLESS_AI_URL;
      else process.env.STAFFLESS_AI_URL = savedUrl;
    };
  }

  it("rejects bad graph args before any catalog read", async () => {
    const savedPat = process.env.STAFFLESS_AI_PAT;
    const savedKey = process.env.ONYX_API_KEY;
    delete process.env.STAFFLESS_AI_PAT;
    delete process.env.ONYX_API_KEY;
    try {
      const missing = await dispatchAskTool(ASK_TOOL_LINKED_ITEMS, {});
      assert.match(missing.result, /invalid_args/);
      const kindWithChildren = await dispatchAskTool(ASK_TOOL_LINKED_ITEMS, {
        key: "RD-114",
        relation: "children",
        link_kind: "Blocks",
      });
      assert.match(kindWithChildren.result, /invalid_args/);
      const tooDeep = await dispatchAskTool(ASK_TOOL_LINKED_ITEMS, { key: "RD-114", depth: 9 });
      assert.match(tooDeep.result, /invalid_args/);
      const noKeys = await dispatchAskTool(ASK_TOOL_DEPENDENCY_CLOSURE, { keys: [] });
      assert.match(noKeys.result, /invalid_args/);
      // Valid shape but no PAT: fails closed without touching the network.
      const unconfigured = await dispatchAskTool(ASK_TOOL_LINKED_ITEMS, { key: "RD-114" });
      assert.match(unconfigured.result, /tool_failed/);
    } finally {
      if (savedPat !== undefined) process.env.STAFFLESS_AI_PAT = savedPat;
      if (savedKey !== undefined) process.env.ONYX_API_KEY = savedKey;
    }
  });

  it("returns stored blockers end-to-end through dispatch", async () => {
    const restore = mockCatalogFetch(
      {
        "RD-114": {
          found: true,
          fields: { issuelink: ["RD-101", "RD-107"], issuelink_type: ["Blocks", "Blocks"] },
        },
        "RD-101": { found: true, fields: {} },
        "RD-107": { found: true, fields: {} },
      },
      {}
    );
    try {
      const out = await dispatchAskTool(
        ASK_TOOL_LINKED_ITEMS,
        { source: "jira", key: "RD-114", relation: "linked", link_kind: "Blocks" },
        { sources: [{ id: "jira", label: "Jira", docsIndexed: 5 }] }
      );
      const payload = JSON.parse(out.result) as { related_keys: string[]; edges: unknown[]; note: string };
      assert.deepEqual(payload.related_keys.sort(), ["RD-101", "RD-107"]);
      assert.match(payload.note, /Stored indexed edges only/);
      const closure = await dispatchAskTool(
        ASK_TOOL_DEPENDENCY_CLOSURE,
        { source: "jira", keys: ["RD-114"], direction: "upstream" },
        { sources: [{ id: "jira", label: "Jira", docsIndexed: 5 }] }
      );
      const closed = JSON.parse(closure.result) as { related_keys: string[] };
      assert.deepEqual(closed.related_keys.sort(), ["RD-101", "RD-107"]);
    } finally {
      restore();
    }
  });
});
