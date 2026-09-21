import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  initialS3Scopes,
  isFolderScope,
  MAX_S3_SCOPES_PER_FLOW,
  normalizePatternInput,
  normalizeScopeInput,
  normalizeStoredScope,
  s3FanoutName,
  s3ScopeDisplay,
} from "./scopes";

describe("s3 scopes", () => {
  it("distinguishes folder scopes from flat-bucket patterns", () => {
    assert.equal(isFolderScope("releases/frontend/"), true);
    assert.equal(isFolderScope("invoice-2024-"), false);
    assert.equal(s3ScopeDisplay("releases/frontend/"), "releases/frontend");
    assert.equal(s3ScopeDisplay("invoice-2024-"), "invoice-2024-*");
  });

  it("names fan-out connectors with their scope only when fanning out", () => {
    assert.equal(s3FanoutName("S3 releases", "releases/frontend/", false), "S3 releases");
    assert.equal(s3FanoutName("S3 releases", "releases/frontend/", true), "S3 releases (releases/frontend)");
    assert.equal(s3FanoutName("S3 invoices", "invoice-2024-", true), "S3 invoices (invoice-2024-*)");
  });

  it("rejects the whole bucket and wildcards in pasted paths", () => {
    assert.match(normalizeScopeInput("").error ?? "", /whole bucket/);
    assert.match(normalizeScopeInput("   ").error ?? "", /whole bucket/);
    assert.match(normalizeScopeInput("*").error ?? "", /no wildcards/);
    assert.match(normalizeScopeInput("a//b").error ?? "", /empty segments/);
    assert.equal(normalizeScopeInput("releases/frontend").scope, "releases/frontend/");
    assert.equal(normalizeScopeInput("/releases/docs/").scope, "releases/docs/");
  });

  it("validates flat-bucket patterns separately", () => {
    assert.equal(normalizePatternInput("invoice-2024-").scope, "invoice-2024-");
    assert.match(normalizePatternInput("").error ?? "", /start of the filenames/);
    assert.match(normalizePatternInput("docs/").error ?? "", /match filenames/);
  });

  it("keeps stored scopes intact for previews", () => {
    assert.equal(normalizeStoredScope("releases/frontend/"), "releases/frontend/");
    assert.equal(normalizeStoredScope("invoice-2024-"), "invoice-2024-");
    assert.equal(normalizeStoredScope("/releases/"), "releases/");
  });

  it("restores the saved prefix when editing", () => {
    assert.deepEqual(initialS3Scopes({ prefix: "releases/frontend/" }), ["releases/frontend/"]);
    assert.deepEqual(initialS3Scopes({}), []);
  });

  it("caps fan-out per flow", () => {
    assert.ok(MAX_S3_SCOPES_PER_FLOW <= 10);
  });
});
