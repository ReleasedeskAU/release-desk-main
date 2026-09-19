import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectAskEvalCases, skipReasonForSource } from "./cases";

describe("ask-eval cases", () => {
  it("skips when the required source is missing or empty", () => {
    assert.equal(skipReasonForSource("github", []), "source_missing:github");
    assert.equal(
      skipReasonForSource("github", [{ id: "github", label: "GitHub", docsIndexed: 0 }]),
      "source_empty:github"
    );
    assert.equal(
      skipReasonForSource("github", [{ id: "github", label: "GitHub", docsIndexed: 3 }]),
      null
    );
  });

  it("selects a subset of the closed list and rejects unknown ids", () => {
    const rows = selectAskEvalCases(["JIRA_KEY", "CHANNEL"]);
    assert.deepEqual(
      rows.map((r) => r.id),
      ["JIRA_KEY", "CHANNEL"]
    );
    assert.throws(() => selectAskEvalCases(["NOPE"]));
  });
});
