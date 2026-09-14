import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  assertBitbucketConnectorReachable,
  BitbucketProbeError,
  firstBitbucketSlug,
  isStaleBitbucketEngineCheck,
} from "./probe";
import { CatalogCreateError } from "@/lib/admin-connectors/plan-create";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("firstBitbucketSlug", () => {
  it("takes the first comma-separated slug", () => {
    assert.equal(firstBitbucketSlug("website-test,other", "Repository slugs", false), "website-test");
  });

  it("rejects a workspace/repo path", () => {
    assert.throws(
      () => firstBitbucketSlug("testing-connector/website-test", "Workspace", true),
      CatalogCreateError
    );
  });
});

describe("assertBitbucketConnectorReachable", () => {
  it("accepts a reachable repository", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await assertBitbucketConnectorReachable({
      email: "owner@example.com",
      token: "tok",
      workspace: "testing-connector",
      repositories: "website-test",
    });
    assert.equal(urls.length, 1);
    assert.ok(urls[0]?.includes("/repositories/testing-connector/website-test"));
  });

  it("maps 401 on the repo to a credentials error", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await assert.rejects(
      () =>
        assertBitbucketConnectorReachable({
          email: "owner@example.com",
          token: "tok",
          workspace: "testing-connector",
          repositories: "website-test",
        }),
      (err: unknown) => err instanceof BitbucketProbeError && err.message.includes("credentials")
    );
  });
});

describe("isStaleBitbucketEngineCheck", () => {
  it("detects the mapped workspace 404", () => {
    assert.equal(isStaleBitbucketEngineCheck("Bitbucket could not find that workspace."), true);
    assert.equal(isStaleBitbucketEngineCheck("StaffLess AI rejected the request"), false);
  });
});
