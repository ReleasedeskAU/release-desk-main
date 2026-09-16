import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupBitbucketReposByWorkspace,
  normalizeBitbucketRepo,
  parseBitbucketRepoSelection,
} from "./repos";

describe("normalizeBitbucketRepo", () => {
  it("accepts workspace/slug and strips a bitbucket.org URL", () => {
    assert.deepEqual(normalizeBitbucketRepo("acme/app"), {
      workspace: "acme",
      name: "app",
      fullName: "acme/app",
    });
    assert.equal(normalizeBitbucketRepo("https://bitbucket.org/acme/app")?.fullName, "acme/app");
  });

  it("rejects a missing slash", () => {
    assert.equal(normalizeBitbucketRepo("no-slash"), null);
    assert.equal(normalizeBitbucketRepo("acme/app/extra"), null);
  });
});

describe("parseBitbucketRepoSelection", () => {
  it("reads a same-workspace list and all-repos for one workspace", () => {
    assert.deepEqual(parseBitbucketRepoSelection({ repos: ["acme/app", "acme/api"] }), {
      workspace: "acme",
      names: ["app", "api"],
      allRepos: false,
    });
    assert.deepEqual(parseBitbucketRepoSelection({ allRepos: true, workspace: "acme" }), {
      workspace: "acme",
      names: [],
      allRepos: true,
    });
  });

  it("refuses mixed workspaces in one selection", () => {
    assert.throws(() => parseBitbucketRepoSelection({ repos: ["acme/app", "other/lib"] }), /repository/);
  });
});

describe("groupBitbucketReposByWorkspace", () => {
  it("splits two workspaces into two connector selections", () => {
    const groups = groupBitbucketReposByWorkspace(["acme/app", "other/lib", "acme/api"]);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups.find((g) => g.workspace === "acme")?.names.sort(), ["api", "app"]);
  });
});
