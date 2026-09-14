import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicStafflessError } from "./client";

describe("publicStafflessError", () => {
  it("does not echo upstream bodies", () => {
    assert.equal(publicStafflessError(401), "StaffLess AI rejected the request");
    assert.equal(publicStafflessError(500), "StaffLess AI is unavailable");
    assert.ok(!publicStafflessError(422).includes("index_name"));
    const leaked = publicStafflessError(400, 'unexpected keyword argument "include_prs" token=secret');
    assert.equal(
      leaked,
      "The index engine rejected this source configuration. Restart the index engine and try again."
    );
    assert.ok(!leaked.includes("include_prs"));
    assert.ok(!leaked.includes("secret"));
    assert.equal(
      publicStafflessError(400, "Connector by this name already exists, duplicate naming not allowed."),
      "A connector with this name already exists. Use a different name, or delete the leftover connector."
    );
    assert.equal(
      publicStafflessError(400, "Unexpected Bitbucket error (status=404)."),
      "Bitbucket could not find that workspace."
    );
  });
});
