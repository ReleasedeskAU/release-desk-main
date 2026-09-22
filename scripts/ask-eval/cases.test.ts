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

  it("includes LATEST_MESSAGE in the closed list", () => {
    const rows = selectAskEvalCases(["LATEST_MESSAGE"]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, "LATEST_MESSAGE");
    assert.equal(rows[0]?.requiresSource, "slack");
  });

  it("selects a subset of the closed list and rejects unknown ids", () => {
    const rows = selectAskEvalCases(["JIRA_KEY", "CHANNEL"]);
    assert.deepEqual(
      rows.map((r) => r.id),
      ["JIRA_KEY", "CHANNEL"]
    );
    assert.throws(() => selectAskEvalCases(["NOPE"]));
  });

  it("includes both scheduled phrasings with dual-source gates", () => {
    const rows = selectAskEvalCases(["SCHEDULED_TEAMS_CONF", "SCHEDULED_TEAMS_CONF_TYPO"]);
    assert.deepEqual(
      rows.map((r) => r.question),
      ["when release 36.2 is scheduled ?", "tell when release 36.2 is schedules"]
    );
    assert.ok(rows.every((r) => r.requiresSource === "teams" && r.alsoRequiresSource === "confluence"));
    assert.equal(
      skipReasonForSource("confluence", [{ id: "teams", label: "Teams", docsIndexed: 4 }]),
      "source_missing:confluence"
    );
    assert.equal(
      skipReasonForSource("confluence", [{ id: "confluence", label: "Confluence", docsIndexed: 9 }]),
      null
    );
  });
});
