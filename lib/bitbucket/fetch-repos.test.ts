import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchBitbucketRepos } from "./fetch-repos";
import { BitbucketProbeError } from "./probe";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchBitbucketRepos", () => {
  it("lists repos from each workspace, not the deprecated global list", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/workspaces?")) {
        return new Response(JSON.stringify({ values: [{ slug: "acme" }, { slug: "other" }] }), { status: 200 });
      }
      if (url.includes("/repositories/acme")) {
        return new Response(JSON.stringify({ values: [{ full_name: "acme/app", name: "App" }] }), { status: 200 });
      }
      if (url.includes("/repositories/other")) {
        return new Response(JSON.stringify({ values: [{ full_name: "other/lib", name: "Lib" }] }), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    }) as typeof fetch;

    const repos = await fetchBitbucketRepos("owner@example.com", "tok");
    assert.deepEqual(
      repos.map((r) => r.fullName),
      ["acme/app", "other/lib"]
    );
    assert.equal(urls.some((u) => /\/repositories\?role=member/.test(u)), false);
    assert.ok(urls.some((u) => u.includes("/workspaces?")));
  });

  it("maps 401 on workspaces to a credentials error", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await assert.rejects(
      () => fetchBitbucketRepos("owner@example.com", "tok"),
      (err: unknown) => err instanceof BitbucketProbeError && err.message.includes("credentials")
    );
  });

  it("says when the token cannot list workspaces", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
    await assert.rejects(
      () => fetchBitbucketRepos("owner@example.com", "tok"),
      (err: unknown) =>
        err instanceof BitbucketProbeError &&
        err.message.includes("cannot list repositories")
    );
  });

  it("says when workspaces exist but no repositories come back", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/workspaces?")) {
        return new Response(JSON.stringify({ values: [{ slug: "acme" }] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    await assert.rejects(
      () => fetchBitbucketRepos("owner@example.com", "tok"),
      (err: unknown) => err instanceof BitbucketProbeError && err.message.includes("no repositories")
    );
  });
});
