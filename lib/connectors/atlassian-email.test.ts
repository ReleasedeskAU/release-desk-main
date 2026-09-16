import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeAtlassianEmail } from "./atlassian-email";

describe("looksLikeAtlassianEmail", () => {
  it("accepts a simple email and rejects a username", () => {
    assert.equal(looksLikeAtlassianEmail("owner@example.com"), true);
    assert.equal(looksLikeAtlassianEmail("hjgdakewajd"), false);
    assert.equal(looksLikeAtlassianEmail(""), false);
  });
});
