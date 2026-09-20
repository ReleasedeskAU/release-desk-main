import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StafflessSearchDoc } from "../../lib/staffless/map-search-docs";
import { scoreSearchRank, scoreTimePair } from "./search-score";

function doc(partial: StafflessSearchDoc): StafflessSearchDoc {
  return partial;
}

describe("scoreSearchRank", () => {
  it("passes JIRA_KEY top-1 when BN-378 is first, not BN-377", () => {
    const docs = [
      doc({ semantic_identifier: "BN-378: Ask Retrieval Quality", document_id: "https://x/browse/BN-378" }),
      doc({ semantic_identifier: "BN-377: implementing Hybrid search" }),
    ];
    const scored = scoreSearchRank("JIRA_KEY", docs);
    assert.equal(scored.kind, "identity");
    assert.equal(scored.top1, true);
    assert.equal(scored.rank, 1);
  });

  it("fails DESC top-1 when BN-378 is sixth, still counts top-10", () => {
    const docs = Array.from({ length: 6 }, (_, i) =>
      doc({
        semantic_identifier:
          i === 5 ? "BN-378: Ask Retrieval Quality" : `BN-${i + 1}: other`,
      })
    );
    const scored = scoreSearchRank("DESC", docs);
    assert.equal(scored.top1, false);
    assert.equal(scored.top3, false);
    assert.equal(scored.top10, true);
    assert.equal(scored.rank, 6);
  });

  it("does not treat BN-3780 as BN-378", () => {
    const scored = scoreSearchRank("JIRA_KEY", [
      doc({ semantic_identifier: "BN-3780: overflow" }),
    ]);
    assert.equal(scored.top1, false);
    assert.equal(scored.rank, null);
  });

  it("passes THREAD_A1 when the token is in the title", () => {
    const scored = scoreSearchRank("THREAD_A1", [
      doc({ semantic_identifier: "admin in #social: TESTFACT-A1: latency", source_type: "slack" }),
    ]);
    assert.equal(scored.top1, true);
  });

  it("passes AUTHOR only for Slack #social, not Confluence Overview", () => {
    const fail = scoreSearchRank("AUTHOR", [
      doc({ semantic_identifier: "Overview", source_type: "confluence" }),
      doc({ semantic_identifier: "admin in #social: hello", source_type: "slack" }),
    ]);
    assert.equal(fail.top1, false);
    assert.equal(fail.rank, 2);
    const pass = scoreSearchRank("CHANNEL", [
      doc({ semantic_identifier: "hello", source_type: "slack", metadata: { channel: "social" } }),
    ]);
    assert.equal(pass.top1, true);
  });

  it("does not count a GitHub file with social in the path as CHANNEL", () => {
    const scored = scoreSearchRank("CHANNEL", [
      doc({
        semantic_identifier: "backend/social/readme.md",
        source_type: "github",
      }),
    ]);
    assert.equal(scored.rank, null);
  });

  it("passes MISSING when RD-999999 is absent; fails when present", () => {
    const absent = scoreSearchRank("MISSING", [
      doc({ semantic_identifier: "BN-378: Ask Retrieval Quality" }),
    ]);
    assert.equal(absent.kind, "missing");
    assert.equal(absent.top1, true);
    assert.equal(absent.reason, "missing_key_absent");
    const present = scoreSearchRank("MISSING", [
      doc({ semantic_identifier: "RD-999999: ghost" }),
    ]);
    assert.equal(present.top1, false);
    assert.equal(present.reason, "missing_key_present");
  });

  it("passes TIME_HYBRID when the recent ticket outranks the older commit", () => {
    const pair = {
      id: "TIME_HYBRID" as const,
      question: "hybrid search",
      requiresSource: "jira" as const,
      recentNeedle: "BN-378",
      olderNeedle: "Configure hybrid search subquery",
    };
    const pass = scoreTimePair(pair, [
      doc({ semantic_identifier: "BN-378: Ask Retrieval Quality" }),
      doc({ semantic_identifier: "feat(opensearch): Configure hybrid search subquery groups" }),
    ]);
    assert.equal(pass.kind, "time_pair");
    assert.equal(pass.top1, true);
    assert.equal(pass.reason, "recent_rank_1_before_2");
    const fail = scoreTimePair(pair, [
      doc({ semantic_identifier: "feat(opensearch): Configure hybrid search subquery groups" }),
      doc({ semantic_identifier: "BN-377: implementing Hybrid search" }),
      doc({ semantic_identifier: "BN-378: Ask Retrieval Quality" }),
    ]);
    assert.equal(fail.top1, false);
    assert.equal(fail.reason, "recent_rank_3_after_1");
  });

  it("marks count cases not applicable", () => {
    for (const id of ["GH_CLOSED", "GH_REPOS", "RESOLVED"] as const) {
      const scored = scoreSearchRank(id, [
        doc({ semantic_identifier: "anything", source_type: "github" }),
      ]);
      assert.equal(scored.kind, "not_applicable");
      assert.equal(scored.top1, null);
    }
  });
});
