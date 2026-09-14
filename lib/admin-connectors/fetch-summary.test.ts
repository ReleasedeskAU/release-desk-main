import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ADMIN_CONNECTOR_SOURCES } from "./catalog";
import { getFetchSummary, hasFetchSummary } from "./fetch-summary";

describe("admin connector fetch summary", () => {
  it("lists at least one fetch point for every catalog source", () => {
    for (const source of ADMIN_CONNECTOR_SOURCES) {
      assert.equal(hasFetchSummary(source.id), true, source.id);
      const summary = getFetchSummary(source.id);
      assert.ok(summary.fetches.length > 0, source.id);
    }
  });

  it("keeps GitHub comments and Jira custom fields in the skip list", () => {
    const github = getFetchSummary("github");
    assert.ok(github.skips.some((item) => /comment/i.test(item)));
    const jira = getFetchSummary("jira");
    assert.ok(jira.skips.some((item) => /custom field/i.test(item)));
    const bitbucket = getFetchSummary("bitbucket");
    assert.ok(bitbucket.fetches.some((item) => /readme/i.test(item)));
    assert.ok(bitbucket.fetches.some((item) => /commit/i.test(item)));
    assert.ok(bitbucket.skips.some((item) => /diff/i.test(item)));
  });

  it("does not invent a dedicated summary for an unknown source", () => {
    assert.equal(hasFetchSummary("not_a_catalog_source"), false);
    const fallback = getFetchSummary("not_a_catalog_source");
    assert.ok(fallback.fetches.length > 0);
    assert.equal(fallback.skips.length, 0);
  });
});
