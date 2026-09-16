import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { evaluateConnectorFieldCheck } from "@/lib/connectors/check-fields";
import {
  GITHUB_MISSING_CONTENTS_READ,
  GITHUB_MISSING_REPO_SCOPE,
  acceptedPermissionsIncludeContentsRead,
  assertGithubTokenReachable,
  classicScopesIncludeRepoRead,
  githubContents404IsEmptyRepo,
  parseGithubOAuthScopes,
} from "@/lib/github/probe";
import { GithubReposFetchError, publicGithubHttpMessage } from "@/lib/github/fetch-repos";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: headers ?? {} });
}

describe("publicGithubHttpMessage", () => {
  it("names invalid or revoked on 401", () => {
    assert.match(publicGithubHttpMessage(401), /invalid or has been revoked/i);
  });
});

describe("classicScopesIncludeRepoRead", () => {
  it("accepts repo and public_repo only", () => {
    assert.equal(classicScopesIncludeRepoRead(parseGithubOAuthScopes("repo")), true);
    assert.equal(classicScopesIncludeRepoRead(parseGithubOAuthScopes("public_repo, gist")), true);
    assert.equal(classicScopesIncludeRepoRead(parseGithubOAuthScopes("")), false);
    assert.equal(classicScopesIncludeRepoRead(parseGithubOAuthScopes("read:user")), false);
  });
});

describe("acceptedPermissionsIncludeContentsRead", () => {
  it("requires contents=read", () => {
    assert.equal(acceptedPermissionsIncludeContentsRead("metadata=read;contents=read"), true);
    assert.equal(acceptedPermissionsIncludeContentsRead("metadata=read"), false);
    assert.equal(acceptedPermissionsIncludeContentsRead(null), false);
  });
});

describe("githubContents404IsEmptyRepo", () => {
  it("accepts only GitHub's empty-repository message", () => {
    assert.equal(githubContents404IsEmptyRepo('{"message":"This repository is empty."}'), true);
    assert.equal(githubContents404IsEmptyRepo('{"message":"Not Found"}'), false);
    assert.equal(githubContents404IsEmptyRepo(""), false);
  });
});

describe("assertGithubTokenReachable", () => {
  it("rejects a blank token without calling GitHub", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await assert.rejects(() => assertGithubTokenReachable("  "), GithubReposFetchError);
    assert.equal(called, false);
  });

  it("maps GitHub 401 to invalid or revoked", async () => {
    globalThis.fetch = (async () => new Response("Bad credentials", { status: 401 })) as typeof fetch;
    await assert.rejects(
      () => assertGithubTokenReachable("gebrisj"),
      (err: unknown) =>
        err instanceof GithubReposFetchError &&
        err.status === 401 &&
        /invalid or has been revoked/i.test(err.message) &&
        !err.message.includes("Bad credentials")
    );
  });

  it("maps 403 on repo list to a repo-access message, not a generic failure", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 403 })) as typeof fetch;
    await assert.rejects(
      () => assertGithubTokenReachable("ghp_example"),
      (err: unknown) =>
        err instanceof GithubReposFetchError &&
        err.status === 403 &&
        /cannot list repositories/i.test(err.message)
    );
  });

  it("rejects a classic token with no repo scope and names repo / public_repo", async () => {
    globalThis.fetch = (async () =>
      jsonResponse([], 200, { "X-OAuth-Scopes": "" })) as typeof fetch;
    await assert.rejects(
      () => assertGithubTokenReachable("ghp_noperms"),
      (err: unknown) =>
        err instanceof GithubReposFetchError &&
        err.status === 403 &&
        err.message === GITHUB_MISSING_REPO_SCOPE
    );
  });

  it("accepts a classic token with the repo scope", async () => {
    globalThis.fetch = (async () =>
      jsonResponse([], 200, { "X-OAuth-Scopes": "repo" })) as typeof fetch;
    await assertGithubTokenReachable("ghp_example");
  });

  it("rejects a fine-grained token missing Contents: Read and names that permission", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/contents/")) {
        return jsonResponse({ message: "Not Found" }, 403, {
          "X-Accepted-GitHub-Permissions": "contents=read",
        });
      }
      return jsonResponse([{ full_name: "acme/app" }], 200, {
        "X-Accepted-GitHub-Permissions": "metadata=read",
      });
    }) as typeof fetch;
    await assert.rejects(
      () => assertGithubTokenReachable("github_pat_noperms"),
      (err: unknown) =>
        err instanceof GithubReposFetchError &&
        err.status === 403 &&
        err.message === GITHUB_MISSING_CONTENTS_READ
    );
  });

  it("rejects a fine-grained token that can read public files without Contents: Read", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/contents/")) {
        return jsonResponse([], 200);
      }
      return jsonResponse([{ full_name: "acme/app" }], 200);
    }) as typeof fetch;
    await assert.rejects(
      () => assertGithubTokenReachable("github_pat_publicbypass"),
      (err: unknown) =>
        err instanceof GithubReposFetchError && err.message === GITHUB_MISSING_CONTENTS_READ
    );
  });

  it("rejects a fine-grained token whose contents call 404s with Not Found", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/contents/")) {
        return jsonResponse({ message: "Not Found" }, 404);
      }
      return jsonResponse([{ full_name: "acme/app" }], 200, {
        "X-Accepted-GitHub-Permissions": "metadata=read",
      });
    }) as typeof fetch;
    await assert.rejects(
      () => assertGithubTokenReachable("github_pat_noperms"),
      (err: unknown) =>
        err instanceof GithubReposFetchError &&
        err.status === 403 &&
        err.message === GITHUB_MISSING_CONTENTS_READ
    );
  });

  it("accepts a fine-grained token with Contents: Read", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/contents/")) {
        return jsonResponse([], 200, { "X-Accepted-GitHub-Permissions": "contents=read" });
      }
      return jsonResponse([{ full_name: "acme/app" }], 200, {
        "X-Accepted-GitHub-Permissions": "metadata=read",
      });
    }) as typeof fetch;
    await assertGithubTokenReachable("github_pat_ok");
  });

  it("accepts contents 404 as an empty repository, not a missing permission", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/contents/")) {
        return jsonResponse({ message: "This repository is empty." }, 404);
      }
      return jsonResponse([{ full_name: "acme/app" }], 200);
    }) as typeof fetch;
    await assertGithubTokenReachable("github_pat_empty");
  });
});

describe("evaluateConnectorFieldCheck", () => {
  it("rejects garbage GitHub tokens after GitHub returns 401", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    const result = await evaluateConnectorFieldCheck({
      type: "github",
      credentials: { token: "gebrisj" },
      config: { allRepos: true, repoOwner: "n" },
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /invalid or has been revoked/i);
  });

  it("rejects a valid classic token missing repo scope with a specific message", async () => {
    globalThis.fetch = (async () =>
      jsonResponse([], 200, { "X-OAuth-Scopes": "" })) as typeof fetch;
    const result = await evaluateConnectorFieldCheck({
      type: "github",
      credentials: { token: "ghp_noperms" },
      config: { allRepos: true, repoOwner: "n" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.message, GITHUB_MISSING_REPO_SCOPE);
  });

  it("accepts a GitHub token GitHub accepts with repo scope", async () => {
    globalThis.fetch = (async () =>
      jsonResponse([], 200, { "X-OAuth-Scopes": "repo" })) as typeof fetch;
    const result = await evaluateConnectorFieldCheck({
      type: "github",
      credentials: { token: "ghp_example" },
      config: { allRepos: true, repoOwner: "n" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.message, "GitHub accepted this token.");
  });
});
