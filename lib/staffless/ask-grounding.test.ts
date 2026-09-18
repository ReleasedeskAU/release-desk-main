import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASK_TOOL_DOCUMENT_BY_KEY,
  ASK_TOOL_DOCUMENT_CONTENT,
  ASK_TOOL_GET_VERIFIED_COUNT,
  ASK_TOOL_LIST_MATCHING,
  ASK_TOOL_SEARCH_INDEX,
} from "./ask-tools";
import { askGroundingFromTools } from "./ask-grounding";

describe("askGroundingFromTools", () => {
  it("marks catalog lookups as verified without claiming the answer is correct", () => {
    assert.equal(askGroundingFromTools([ASK_TOOL_GET_VERIFIED_COUNT]), "verified");
    assert.equal(askGroundingFromTools([ASK_TOOL_DOCUMENT_BY_KEY]), "verified");
    assert.equal(askGroundingFromTools([ASK_TOOL_LIST_MATCHING]), "verified");
  });

  it("marks semantic search as search-based", () => {
    assert.equal(askGroundingFromTools([ASK_TOOL_SEARCH_INDEX]), "search");
    assert.equal(askGroundingFromTools([ASK_TOOL_DOCUMENT_CONTENT]), "search");
  });

  it("marks mixed catalog + search, and omits a badge when no tools ran", () => {
    assert.equal(
      askGroundingFromTools([ASK_TOOL_GET_VERIFIED_COUNT, ASK_TOOL_SEARCH_INDEX]),
      "mixed"
    );
    assert.equal(askGroundingFromTools([]), null);
    assert.equal(askGroundingFromTools(["unknown_tool"]), null);
  });
});
