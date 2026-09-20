import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ASK_AGENT_SYSTEM } from "../../lib/staffless/ask-copy";
import { ASK_CANDIDATE_SYSTEM } from "./candidate-system";

describe("ASK_CANDIDATE_SYSTEM", () => {
  it("has the six principles and no connector cookbook sections", () => {
    assert.match(ASK_CANDIDATE_SYSTEM, /Discover before filtering/);
    assert.match(ASK_CANDIDATE_SYSTEM, /Ambiguous values need a companion field/);
    assert.match(ASK_CANDIDATE_SYSTEM, /not recorded/);
    assert.match(ASK_CANDIDATE_SYSTEM, /Attribute claims to their actual source/);
    assert.match(ASK_CANDIDATE_SYSTEM, /actual indexed field/);
    assert.match(ASK_CANDIDATE_SYSTEM, /belongs on the tool, not in this prompt/);
    assert.equal(/Slack \(canonical/.test(ASK_CANDIDATE_SYSTEM), false);
    assert.equal(/GitHub \(canonical/.test(ASK_CANDIDATE_SYSTEM), false);
    assert.equal(/Resolved and open \(canonical/.test(ASK_CANDIDATE_SYSTEM), false);
    assert.equal(/TESTFACT/.test(ASK_CANDIDATE_SYSTEM), false);
    assert.equal(/Never a named Jira ticket key/.test(ASK_CANDIDATE_SYSTEM), false);
    assert.equal(/state=closed AND merged=false/.test(ASK_CANDIDATE_SYSTEM), false);
    assert.equal(/onyx/i.test(ASK_CANDIDATE_SYSTEM), false);
    assert.match(ASK_CANDIDATE_SYSTEM, /How answers are written/);
    assert.equal(ASK_CANDIDATE_SYSTEM, ASK_AGENT_SYSTEM);
  });
});
