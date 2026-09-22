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

  it("fails LATEST_MESSAGE when search is used", () => {
    const scored = scoreAskEvalTurn("LATEST_MESSAGE", "admin said hi in social.", [
      call("search_indexed_documents", { query: "latest message from admin" }),
    ]);
    assert.equal(scored.outcome, "fail");
    assert.equal(scored.reason, "used_search");
  });

  it("fails LATEST_MESSAGE when the list is not date-desc sorted", () => {
    const scored = scoreAskEvalTurn("LATEST_MESSAGE", "admin said hi.", [
      call("list_documents_matching", {
        source: "slack",
        filter_field: "channel",
        filter_value: "social",
        filters: [{ filter_field: "author", filter_value: "admin" }],
      }),
    ]);
    assert.equal(scored.outcome, "fail");
    assert.equal(scored.reason, "no_date_desc_list");
  });

  it("passes LATEST_MESSAGE when a date-desc list first row is cited", () => {
    const scored = scoreAskEvalTurn(
      "LATEST_MESSAGE",
      "The latest post is admin in #social: TESTFACT-A2 webhook.",
      [
        call(
          "list_documents_matching",
          {
            source: "slack",
            filters: [
              { filter_field: "channel", filter_value: "social" },
              { filter_field: "author", filter_value: "admin" },
            ],
            sort_by: "updated_desc",
          },
          JSON.stringify({
            documents: [{ title: "admin in #social: TESTFACT-A2 webhook", document_id: "slack-doc-1" }],
          })
        ),
      ]
    );
    assert.equal(scored.outcome, "pass");
    assert.equal(scored.reason, "list_date_desc");
  });

  it("fails GRAPH_BLOCKERS when search answers a dependency question", () => {
    const scored = scoreAskEvalTurn("GRAPH_BLOCKERS", "RD-101 blocks RD-114.", [
      call("search_indexed_documents", { query: "RD-114 blocking" }),
    ]);
    assert.equal(scored.outcome, "fail");
    assert.equal(scored.reason, "used_search_for_deps");
  });

  it("fails GRAPH_BLOCKERS when link_kind skips stored-value discovery", () => {
    const scored = scoreAskEvalTurn("GRAPH_BLOCKERS", "RD-101 blocks RD-114.", [
      call("get_linked_work_items", { key: "RD-114", relation: "linked", link_kind: "Blocks" }),
    ]);
    assert.equal(scored.outcome, "fail");
    assert.equal(scored.reason, "link_kind_without_discovery");
  });

  it("passes GRAPH_BLOCKERS when link_kind comes from distinct issuelink_type", () => {
    const scored = scoreAskEvalTurn("GRAPH_BLOCKERS", "RD-101 and RD-107 block RD-114.", [
      call(
        "list_distinct_values",
        { source: "jira", field: "issuelink_type" },
        JSON.stringify({ values: ["Blocks", "Relates"], total_indexed: 10, untagged_count: 2 })
      ),
      call("get_linked_work_items", { key: "RD-114", relation: "linked", link_kind: "Blocks" }),
    ]);
    assert.equal(scored.outcome, "pass");
    assert.equal(scored.reason, "graph_blockers");
  });

  it("fails GRAPH_CLOSURE without the closure tool and passes with it", () => {
    const without = scoreAskEvalTurn("GRAPH_CLOSURE", "Release 36.2 touches RD-201.", [
      call("get_verified_count", { source: "jira", filter_field: "labels", filter_value: "release-36.2" }),
    ]);
    assert.equal(without.outcome, "fail");
    assert.equal(without.reason, "no_graph_tool");
    const withClosure = scoreAskEvalTurn("GRAPH_CLOSURE", "Release 36.2 touches RD-201 and RD-301.", [
      call("list_documents_matching", { source: "jira", filter_field: "labels", filter_value: "release-36.2" }),
      call("get_dependency_closure", { source: "jira", keys: ["RD-201"], direction: "upstream" }),
    ]);
    assert.equal(withClosure.outcome, "pass");
  });

  it("passes GRAPH_CHILDREN on either the graph or the catalog parent path", () => {
    const viaGraph = scoreAskEvalTurn("GRAPH_CHILDREN", "BN-16 and BN-17 are children of BN-15.", [
      call("get_linked_work_items", { source: "jira", key: "BN-15", relation: "children" }),
    ]);
    assert.equal(viaGraph.outcome, "pass");
    assert.equal(viaGraph.reason, "graph_children");
    const viaCatalog = scoreAskEvalTurn("GRAPH_CHILDREN", "BN-16 is a child of BN-15.", [
      call("list_documents_matching", { source: "jira", filter_field: "parent", filter_value: "BN-15" }),
    ]);
    assert.equal(viaCatalog.outcome, "pass");
    assert.equal(viaCatalog.reason, "catalog_children_parity");
  });

  it("passes SCHEDULED_TEAMS_CONF on one source=all search citing both sources", () => {
    const rows = JSON.stringify({
      documents: [
        { title: "Release 36.2 schedule", source: "Microsoft Teams", link: "https://teams.test/t1" },
        { title: "36.2 test plan", source: "confluence", link: "https://conf.test/c1" },
      ],
    });
    for (const id of ["SCHEDULED_TEAMS_CONF", "SCHEDULED_TEAMS_CONF_TYPO"] as const) {
      const scored = scoreAskEvalTurn(
        id,
        "Release 36.2 is scheduled per Release 36.2 schedule and the 36.2 test plan.",
        [call("search_indexed_documents", { query: "when release 36.2 is scheduled", source: "all" }, rows)]
      );
      assert.equal(scored.outcome, "pass");
      assert.equal(scored.reason, "scheduled_teams_conf");
    }
  });

  it("fails SCHEDULED_TEAMS_CONF on catalog detours and named-source searches", () => {
    const rows = JSON.stringify({
      documents: [{ title: "Release 36.2 schedule", source: "teams", link: "https://teams.test/t1" }],
    });
    const detour = scoreAskEvalTurn("SCHEDULED_TEAMS_CONF", "Release 36.2 is scheduled.", [
      call("search_indexed_documents", { query: "release 36.2", source: "all" }, rows),
      call("get_verified_count", { source: "jira", filter_field: "labels", filter_value: "release-36.2" }),
    ]);
    assert.equal(detour.outcome, "fail");
    assert.equal(detour.reason, "catalog_detour");
    const named = scoreAskEvalTurn("SCHEDULED_TEAMS_CONF", "Release 36.2 is scheduled.", [
      call("search_indexed_documents", { query: "release 36.2", source: "jira" }, rows),
    ]);
    assert.equal(named.outcome, "fail");
    assert.equal(named.reason, "not_source_all_search");
  });

  it("fails SCHEDULED_TEAMS_CONF on deferral and uncited rows", () => {
    const both = JSON.stringify({
      documents: [
        { title: "Release 36.2 schedule", source: "teams", link: "https://teams.test/t1" },
        { title: "36.2 test plan", source: "confluence", link: "https://conf.test/c1" },
      ],
    });
    const deferred = scoreAskEvalTurn(
      "SCHEDULED_TEAMS_CONF",
      "Which connector should I search for the release schedule?",
      [call("search_indexed_documents", { query: "release 36.2", source: "all" }, both)]
    );
    assert.equal(deferred.outcome, "fail");
    assert.equal(deferred.reason, "clarifying_deferral");
    // Live shape is Teams+Jira rows with the Teams schedule row cited.
    const live = JSON.stringify({
      documents: [
        { title: "Release 36.2 schedule", source: "Microsoft Teams", link: "https://teams.test/t1" },
        { title: "3. Test data", source: "Jira", link: "https://jira.test/BN-1" },
      ],
    });
    const livePass = scoreAskEvalTurn(
      "SCHEDULED_TEAMS_CONF",
      "Release 36.2 is scheduled Wednesday per Release 36.2 schedule.",
      [call("search_indexed_documents", { query: "release 36.2", source: "all" }, live)]
    );
    assert.equal(livePass.outcome, "pass");
    // Confluence rows present but ignored is still a failure.
    const uncited = scoreAskEvalTurn(
      "SCHEDULED_TEAMS_CONF_TYPO",
      "Release 36.2 is scheduled per Release 36.2 schedule.",
      [call("search_indexed_documents", { query: "release 36.2", source: "all" }, both)]
    );
    assert.equal(uncited.outcome, "fail");
    assert.equal(uncited.reason, "single_source_citation");
  });

  it("allows a body read of an already-found schedule row", () => {
    const rows = JSON.stringify({
      documents: [
        { title: "Release 36.2 schedule", source: "teams", document_id: "teams-doc-1" },
      ],
    });
    const scored = scoreAskEvalTurn(
      "SCHEDULED_TEAMS_CONF_TYPO",
      "Release 36.2 is scheduled Wednesday per Release 36.2 schedule.",
      [
        call("search_indexed_documents", { query: "release 36.2", source: "all" }, rows),
        call("get_document_content", { document_id: "teams-doc-1" }, JSON.stringify({ found: true })),
      ]
    );
    assert.equal(scored.outcome, "pass");
  });
});
