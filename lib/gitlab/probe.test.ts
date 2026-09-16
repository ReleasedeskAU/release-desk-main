import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { evaluateConnectorFieldCheck } from "@/lib/connectors/check-fields";
import {
  GITLAB_INVALID_TOKEN,
  GITLAB_MISSING_API,
  GitlabProbeError,
  assertGitlabTokenReachable,
} from "./probe";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("assertGitlabTokenReachable", () => {
  it("rejects a blank token without calling GitLab", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await assert.rejects(
      () => assertGitlabTokenReachable("https://gitlab.com", "  "),
      GitlabProbeError
    );
    assert.equal(called, false);
  });

  it("maps GitLab 401 to invalid or revoked", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await assert.rejects(
      () => assertGitlabTokenReachable("https://gitlab.com", "glpat-example"),
      (err: unknown) =>
        err instanceof GitlabProbeError && err.status === 401 && err.message === GITLAB_INVALID_TOKEN
    );
  });

  it("maps 403 to a missing read_api message", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 403 })) as typeof fetch;
    await assert.rejects(
      () => assertGitlabTokenReachable("https://gitlab.com", "glpat-example"),
      (err: unknown) =>
        err instanceof GitlabProbeError && err.status === 403 && err.message === GITLAB_MISSING_API
    );
  });

  it("accepts a 200 from /user", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await assertGitlabTokenReachable("https://gitlab.com/", "glpat-example");
    assert.ok(urls[0]?.includes("/api/v4/user"));
  });
});

describe("evaluateConnectorFieldCheck gitlab", () => {
  it("names an invalid token and does not claim fields look valid", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    const result = await evaluateConnectorFieldCheck({
      type: "gitlab",
      baseUrl: "https://gitlab.com",
      credentials: { token: "glpat-bad" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.message, GITLAB_INVALID_TOKEN);
  });

  it("accepts a token GitLab accepts", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    const result = await evaluateConnectorFieldCheck({
      type: "gitlab",
      baseUrl: "https://gitlab.com",
      credentials: { token: "glpat-example" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.message, "GitLab accepted this token.");
  });
});
