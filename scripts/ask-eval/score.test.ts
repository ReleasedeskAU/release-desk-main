import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ASK_PUBLIC_UNAVAILABLE } from "../../lib/staffless/ask-errors";
import { scoreAskEvalTurn } from "./score";
import type { AskToolTraceCall } from "../../lib/staffless/ask-agent";

function call(name: string, args: Record<string, unknown>, result = "{}"): AskToolTraceCall {
  return { round: 1, name, arguments: args, result };
}

describe("scoreAskEvalTurn", () => {
  it("marks empty and public-unavailable answers as infra, not model fail", () => {
    assert.equal(scoreAskEvalTurn("JIRA_KEY", "", []).outcome, "infra");
    assert.equal(scoreAskEvalTurn("JIRA_KEY", ASK_PUBLIC_UNAVAILABLE, []).outcome, "infra");
    assert.equal(
      scoreAskEvalTurn("JIRA_KEY", "I could not complete that lookup.", [
        call(
          "get_document_by_key",
          { key: "BN-378" },
          JSON.stringify({ error: "tool_failed", retryable: true })
        ),
      ]).outcome,
      "infra"
    );
  });

  it("fails GH_CLOSED when state=closed is used without merged", () => {
    const scored = scoreAskEvalTurn("GH_CLOSED", "12 PRs are closed.", [
      call("get_verified_count", { source: "github", object_type: "PullRequest", state: "closed" }),
    ]);
    assert.equal(scored.outcome, "fail");
    assert.equal(scored.reason, "closed_without_merged");
  });

  it("passes GH_CLOSED when merged is queried", () => {
    const scored = scoreAskEvalTurn("GH_CLOSED", "3 merged, 1 closed without merging.", [
      call("get_verified_count", { source: "github", object_type: "PullRequest", merged: "true" }),
    ]);
    assert.equal(scored.outcome, "pass");
  });

  it("fails AUTHOR when it claims absence without searching", () => {
    const scored = scoreAskEvalTurn("AUTHOR", "Author is not found; a Slack re-index is needed.", [
      call("list_distinct_values", { source: "slack", field: "author" }),
    ]);
    assert.equal(scored.outcome, "fail");
    assert.equal(scored.reason, "absent_without_search");
  });

  it("passes AUTHOR when search is used", () => {
    const scored = scoreAskEvalTurn("AUTHOR", "admin posted in social.", [
      call("search_indexed_documents", { source: "slack", query: "who posted" }),
    ]);
    assert.equal(scored.outcome, "pass");
  });

  it("passes AUTHOR when an exact list row contains the named author", () => {
    const scored = scoreAskEvalTurn(
      "AUTHOR",
      'The posts in "Sentinel Dev Team" were made by Kabir Mohd.',
      [
        call(
          "list_documents_matching",
          { source: "teams", filter_field: "channel", filter_value: "Sentinel Dev Team" },
          JSON.stringify({ documents: [{ author: "Kabir Mohd" }] })
        ),
      ]
    );
    assert.equal(scored.outcome, "pass");
  });

  it("fails THREAD_A2 when the token is used as a channel filter", () => {
    const scored = scoreAskEvalTurn(
      "THREAD_A2",
      "No indexed Slack documents for the channel TESTFACT-A2.",
      [call("list_documents_matching", { source: "slack", filter_field: "channel", filter_value: "TESTFACT-A2" })]
    );
    assert.equal(scored.outcome, "fail");
    assert.equal(scored.reason, "channel=token");
  });

  it("fails THREAD_A2 when the token is sent to get_document_by_key", () => {
    const scored = scoreAskEvalTurn("THREAD_A2", "Not a Jira ticket.", [
      call("get_document_by_key", { key: "TESTFACT-A2" }),
    ]);
    assert.equal(scored.outcome, "fail");
    assert.equal(scored.reason, "by_key=token");
  });

  it("passes THREAD_A2 on search plus parent and replies", () => {
    const scored = scoreAskEvalTurn(
      "THREAD_A2",
      "webhook retries capped at 5 attempts. reply 1. reply 2.",
      [
        call("search_indexed_documents", { source: "slack", query: "TESTFACT-A2" }),
        call("get_document_content", { document_id: "abc" }),
      ]
    );
    assert.equal(scored.outcome, "pass");
  });

  it("passes JIRA_KEY only when get_document_by_key uses BN-378", () => {
    const miss = scoreAskEvalTurn("JIRA_KEY", "About BN-378", [
      call("search_indexed_documents", { query: "BN-378" }),
    ]);
    assert.equal(miss.outcome, "fail");
    const hit = scoreAskEvalTurn("JIRA_KEY", "BN-378 is a task.", [
      call("get_document_by_key", { key: "BN-378" }),
    ]);
    assert.equal(hit.outcome, "pass");
  });

  it("passes CHANNEL on stored social tag and fails TESTFACT as channel", () => {
    const bad = scoreAskEvalTurn("CHANNEL", "empty", [
      call("list_documents_matching", { filter_field: "channel", filter_value: "TESTFACT-A2" }),
    ]);
    assert.equal(bad.outcome, "fail");
    const good = scoreAskEvalTurn("CHANNEL", "hi and hello", [
      call("list_documents_matching", { source: "slack", filter_field: "channel", filter_value: "social" }),
    ]);
    assert.equal(good.outcome, "pass");
  });

  it("fails GH_REPOS when a bare GitHub count is labeled repositories", () => {
    const scored = scoreAskEvalTurn("GH_REPOS", "There are 40 repositories.", [
      call("get_verified_count", { source: "github" }),
    ]);
    assert.equal(scored.outcome, "fail");
    assert.equal(scored.reason, "docs_as_repos");
  });

  it("passes GH_REPOS when distinct repo is used", () => {
    const scored = scoreAskEvalTurn("GH_REPOS", "2 repositories.", [
      call("list_distinct_values", { source: "github", field: "repo" }),
    ]);
    assert.equal(scored.outcome, "pass");
  });

  it("fails DESC when the body is skipped or called not indexed", () => {
    const skipped = scoreAskEvalTurn("DESC", "BN-378 is a task.", [
      call("get_document_by_key", { key: "BN-378" }),
    ]);
    assert.equal(skipped.outcome, "fail");
    const denied = scoreAskEvalTurn("DESC", "The description is not indexed.", [
      call("get_document_content", { document_id: "x" }),
    ]);
    assert.equal(denied.outcome, "fail");
  });

  it("fails RESOLVED when status display names are filtered", () => {
    const scored = scoreAskEvalTurn("RESOLVED", "12 resolved.", [
      call("get_verified_count", { filter_field: "status", filter_value: "Done" }),
    ]);
    assert.equal(scored.outcome, "fail");
    const good = scoreAskEvalTurn("RESOLVED", "12 resolved.", [
      call("get_verified_count", { filter_field: "status_category", filter_value: "done" }),
    ]);
    assert.equal(good.outcome, "pass");
  });

  it("fails MISSING when a neighbor is answered as the asked ticket", () => {
    const scored = scoreAskEvalTurn("MISSING", "RD-3 is about onboarding.", [
      call("get_document_by_key", { key: "RD-3" }, JSON.stringify({ found: true, key: "RD-3" })),
    ]);
    assert.equal(scored.outcome, "fail");
    const good = scoreAskEvalTurn("MISSING", "RD-999999 is not in the index.", [
      call("get_document_by_key", { key: "RD-999999" }, JSON.stringify({ found: false })),
    ]);
    assert.equal(good.outcome, "pass");
    const exactEmpty = scoreAskEvalTurn(
      "MISSING",
      'The ticket with the key "RD-999999" is not found in the indexed documents.',
      [
        call(
          "list_documents_matching",
          { filter_field: "key", filter_value: "RD-999999" },
          JSON.stringify({ count: 0, documents: [] })
        ),
      ]
    );
    assert.equal(exactEmpty.outcome, "pass");
  });
});
