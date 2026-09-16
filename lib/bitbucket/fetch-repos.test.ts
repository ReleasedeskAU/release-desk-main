import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchBitbucketRepos } from "./fetch-repos";
import { BitbucketProbeError } from "./probe";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchBitbucketRepos", () => {
  it("lists GET /repositories/{workspace}, not a global or permissions list", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ values: [{ full_name: "acme/app", name: "App" }] }), {
        status: 200,
      });
    }) as typeof fetch;

    const repos = await fetchBitbucketRepos("owner@example.com", "tok", "acme");
    assert.equal(repos[0]?.fullName, "acme/app");
    assert.ok(urls[0]?.includes("/repositories/acme?"));
    assert.equal(urls.some((u) => u.includes("/user/permissions")), false);
    assert.equal(urls.some((u) => /\/repositories\?role=member/.test(u)), false);
  });

  it("maps workspace 404 to a slug hint, not a missing-scope hint", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
    await assert.rejects(
      () => fetchBitbucketRepos("owner@example.com", "tok", "acme"),
      (err: unknown) =>
        err instanceof BitbucketProbeError &&
        err.message.includes("workspace") &&
        !err.message.includes("read:workspace")
    );
  });

  it("rejects a missing workspace before calling Bitbucket", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await assert.rejects(
      () => fetchBitbucketRepos("owner@example.com", "tok", "  "),
      BitbucketProbeError
    );
    assert.equal(urls.length, 0);
  });
});
