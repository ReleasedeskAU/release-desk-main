import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { evaluateConnectorFieldCheck } from "@/lib/connectors/check-fields";
import {
  assertBitbucketConnectorReachable,
  assertBitbucketTokenReachable,
  BITBUCKET_EMAIL_REQUIRED,
  BITBUCKET_INVALID_CREDENTIALS,
  BITBUCKET_TOKEN_REQUIRED,
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

  it("maps 401 on the repo to a credentials error that names email and token", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await assert.rejects(
      () =>
        assertBitbucketConnectorReachable({
          email: "owner@example.com",
          token: "tok",
          workspace: "testing-connector",
          repositories: "website-test",
        }),
      (err: unknown) =>
        err instanceof BitbucketProbeError &&
        err.message === BITBUCKET_INVALID_CREDENTIALS &&
        /Atlassian account email/i.test(err.message)
    );
  });

  it("rejects a username-shaped email without calling Bitbucket", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await assert.rejects(
      () =>
        assertBitbucketConnectorReachable({
          email: "hjgdakewajd",
          token: "tok",
          workspace: "testing-connector",
          repositories: "website-test",
        }),
      (err: unknown) =>
        err instanceof BitbucketProbeError &&
        err.status === 400 &&
        err.message === BITBUCKET_EMAIL_REQUIRED
    );
    assert.equal(called, false);
  });
});

describe("assertBitbucketTokenReachable", () => {
  it("accepts Bitbucket /user 200", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    await assertBitbucketTokenReachable("owner@example.com", "tok");
  });

  it("maps 401 to a credentials error that names email and token", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await assert.rejects(
      () => assertBitbucketTokenReachable("owner@example.com", "tok"),
      (err: unknown) =>
        err instanceof BitbucketProbeError && err.message === BITBUCKET_INVALID_CREDENTIALS
    );
  });

  it("rejects a username-shaped email without calling Bitbucket", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await assert.rejects(
      () => assertBitbucketTokenReachable("hjgdakewajd", "tok"),
      (err: unknown) =>
        err instanceof BitbucketProbeError &&
        err.status === 400 &&
        err.message === BITBUCKET_EMAIL_REQUIRED
    );
    assert.equal(called, false);
  });

  it("rejects a blank token without calling Bitbucket", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await assert.rejects(
      () => assertBitbucketTokenReachable("owner@example.com", "  "),
      (err: unknown) =>
        err instanceof BitbucketProbeError &&
        err.status === 400 &&
        err.message === BITBUCKET_TOKEN_REQUIRED
    );
    assert.equal(called, false);
  });
});

describe("evaluateConnectorFieldCheck bitbucket", () => {
  it("accepts credentials Bitbucket accepts", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    const result = await evaluateConnectorFieldCheck({
      type: "bitbucket",
      credentials: { email: "owner@example.com", token: "tok" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.message, "Bitbucket accepted these credentials.");
  });

  it("names a username-shaped email, not a generic credentials rejection", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const result = await evaluateConnectorFieldCheck({
      type: "bitbucket",
      credentials: { email: "hjgdakewajd", token: "tok" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.message, BITBUCKET_EMAIL_REQUIRED);
    assert.equal(called, false);
  });
});

describe("isStaleBitbucketEngineCheck", () => {
  it("detects the mapped workspace 404", () => {
    assert.equal(isStaleBitbucketEngineCheck("Bitbucket could not find that workspace."), true);
    assert.equal(isStaleBitbucketEngineCheck("StaffLess AI rejected the request"), false);
  });
});
