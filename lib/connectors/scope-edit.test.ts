import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commaNames, selectionChanged } from "./scope-edit";

describe("selectionChanged", () => {
  it("ignores order when the same channels stay selected", () => {
    assert.equal(
      selectionChanged({ keys: ["ops", "cab"] }, { keys: ["cab", "ops"] }),
      false
    );
  });

  it("flags a newly added repo", () => {
    assert.equal(
      selectionChanged({ keys: ["acme/app"] }, { keys: ["acme/app", "acme/web"] }),
      true
    );
  });

  it("flags leaving all-projects for a single key", () => {
    assert.equal(
      selectionChanged({ keys: [], all: true }, { keys: ["RD"], all: false }),
      true
    );
  });

  it("treats all-repos as unchanged when it stays on", () => {
    assert.equal(selectionChanged({ keys: [], all: true }, { keys: ["ignored"], all: true }), false);
  });
});

describe("commaNames", () => {
  it("splits team names and drops blanks", () => {
    assert.deepEqual(commaNames(" Support, Engineering, "), ["Support", "Engineering"]);
  });
});
