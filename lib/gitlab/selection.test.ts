import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapGitlabProjectListPayload } from "./projects";
import { normalizeGitlabProject, parseGitlabProjectSelection } from "./selection";

describe("normalizeGitlabProject", () => {
  it("accepts nested groups and strips a site URL", () => {
    assert.deepEqual(normalizeGitlabProject("acme/app"), {
      owner: "acme",
      name: "app",
      fullName: "acme/app",
    });
    assert.equal(normalizeGitlabProject("acme/backend/api")?.fullName, "acme/backend/api");
    assert.equal(normalizeGitlabProject("https://gitlab.com/acme/app")?.fullName, "acme/app");
  });

  it("rejects a missing slash and path traversal", () => {
    assert.equal(normalizeGitlabProject("no-slash"), null);
    assert.equal(normalizeGitlabProject("acme/.."), null);
  });
});

describe("parseGitlabProjectSelection", () => {
  it("reads a list and mixed groups", () => {
    const selection = parseGitlabProjectSelection({
      projects: ["acme/app", "other/lib"],
    });
    assert.deepEqual(selection.paths.sort(), ["acme/app", "other/lib"]);
    assert.equal(selection.owner, "acme");
    assert.equal(selection.name, "app");
  });

  it("refuses an empty selection", () => {
    assert.throws(() => parseGitlabProjectSelection({}), /at least one project/);
  });
});

describe("mapGitlabProjectListPayload", () => {
  it("reads path_with_namespace and skips malformed rows", () => {
    const mapped = mapGitlabProjectListPayload([
      { path_with_namespace: "acme/backend/api", name: "API", visibility: "private" },
      { path_with_namespace: "bad" },
    ]);
    assert.deepEqual(mapped, [
      { fullName: "acme/backend/api", name: "API", owner: "acme/backend", private: true },
    ]);
  });
});
