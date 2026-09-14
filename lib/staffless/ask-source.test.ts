import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  askSourceSlug,
  formatAskSourceInventory,
  isAllowedAskSource,
  uniqueAskSources,
} from "./ask-source";

describe("ask sources", () => {
  it("accepts engine slugs and all", () => {
    assert.equal(askSourceSlug("Bitbucket"), "bitbucket");
    assert.equal(askSourceSlug("all"), "all");
    assert.equal(askSourceSlug("ingestion_api"), null);
    assert.equal(askSourceSlug("not a source"), null);
  });

  it("merges created connectors by type including empty ones", () => {
    const sources = uniqueAskSources([
      { type: "jira", docsIndexed: 10 },
      { type: "bitbucket", docsIndexed: 0 },
      { type: "bitbucket", docsIndexed: 1 },
      { type: "ingestion_api", docsIndexed: 4 },
    ]);
    assert.deepEqual(
      sources.map((item) => ({ id: item.id, docsIndexed: item.docsIndexed })),
      [
        { id: "bitbucket", docsIndexed: 1 },
        { id: "jira", docsIndexed: 10 },
      ]
    );
    assert.equal(sources.find((item) => item.id === "bitbucket")?.label, "Bitbucket");
  });

  it("allows any slug when this turn has no connector list", () => {
    assert.equal(isAllowedAskSource("confluence"), true);
    assert.equal(isAllowedAskSource("confluence", { sources: [] }), true);
    assert.equal(
      isAllowedAskSource("confluence", {
        sources: [{ id: "jira", label: "Jira", docsIndexed: 1 }],
      }),
      false
    );
    assert.equal(
      isAllowedAskSource("jira", {
        sources: [{ id: "jira", label: "Jira", docsIndexed: 1 }],
      }),
      true
    );
  });

  it("lists created sources in the inventory", () => {
    const text = formatAskSourceInventory([
      { id: "bitbucket", label: "Bitbucket", docsIndexed: 1 },
    ]);
    assert.match(text, /source=<id>/);
    assert.match(text, /bitbucket/);
    assert.equal(/only have Jira and GitHub/.test(text), false);
  });
});
