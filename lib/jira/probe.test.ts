import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { evaluateConnectorFieldCheck } from "@/lib/connectors/check-fields";
import { JiraProjectsFetchError } from "@/lib/jira/fetch-projects";
import {
  JIRA_EMAIL_REQUIRED,
  JIRA_INVALID_TOKEN,
  JIRA_SITE_NOT_FOUND,
  JIRA_TOKEN_REQUIRED,
  JIRA_UNREACHABLE_URL,
  JIRA_URL_REQUIRED,
  assertJiraTokenReachable,
  looksLikeAtlassianEmail,
} from "@/lib/jira/probe";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("looksLikeAtlassianEmail", () => {
  it("requires a simple email shape", () => {
    assert.equal(looksLikeAtlassianEmail("a@b.com"), true);
    assert.equal(looksLikeAtlassianEmail("not-an-email"), false);
    assert.equal(looksLikeAtlassianEmail(""), false);
  });
});

describe("assertJiraTokenReachable", () => {
  it("rejects a blank token without calling Jira", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await assert.rejects(
      () => assertJiraTokenReachable("https://ex.atlassian.net", "a@b.com", "  "),
      (err: unknown) =>
        err instanceof JiraProjectsFetchError && err.message === JIRA_TOKEN_REQUIRED
    );
    assert.equal(called, false);
  });

  it("rejects a missing URL without calling Jira", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await assert.rejects(
      () => assertJiraTokenReachable("  ", "a@b.com", "tok"),
      (err: unknown) =>
        err instanceof JiraProjectsFetchError && err.message === JIRA_URL_REQUIRED
    );
    assert.equal(called, false);
  });

  it("rejects http URL without calling Jira", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await assert.rejects(
      () => assertJiraTokenReachable("http://ex.atlassian.net", "a@b.com", "tok"),
      (err: unknown) =>
        err instanceof JiraProjectsFetchError && /must use https/i.test(err.message)
    );
    assert.equal(called, false);
  });

  it("rejects a non-email without calling Jira", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await assert.rejects(
      () => assertJiraTokenReachable("https://ex.atlassian.net", "not-an-email", "tok"),
      (err: unknown) =>
        err instanceof JiraProjectsFetchError && err.message === JIRA_EMAIL_REQUIRED
    );
    assert.equal(called, false);
  });

  it("maps Jira 401 on /myself to a credentials message that names email, token, and URL", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      assert.match(String(input), /\/rest\/api\/3\/myself$/);
      return new Response("Unauthorized", { status: 401 });
    }) as typeof fetch;
    await assert.rejects(
      () => assertJiraTokenReachable("https://ex.atlassian.net", "a@b.com", "not-a-real-jira-token"),
      (err: unknown) =>
        err instanceof JiraProjectsFetchError &&
        err.status === 401 &&
        err.message === JIRA_INVALID_TOKEN &&
        /Atlassian account email/i.test(err.message) &&
        !err.message.includes("Unauthorized")
    );
  });

  it("maps Jira 404 on /myself to a site-URL message, not a token guess", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
    await assert.rejects(
      () => assertJiraTokenReachable("https://ex.atlassian.net", "a@b.com", "tok"),
      (err: unknown) =>
        err instanceof JiraProjectsFetchError &&
        err.status === 404 &&
        err.message === JIRA_SITE_NOT_FOUND
    );
  });

  it("maps a failed fetch to an unreachable-URL message", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await assert.rejects(
      () => assertJiraTokenReachable("https://not-a-real-host.example", "a@b.com", "tok"),
      (err: unknown) =>
        err instanceof JiraProjectsFetchError && err.message === JIRA_UNREACHABLE_URL
    );
  });

  it("accepts Jira 200 on /myself", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    await assertJiraTokenReachable("https://ex.atlassian.net", "a@b.com", "valid-token");
  });
});

describe("evaluateConnectorFieldCheck jira", () => {
  it("rejects a garbage Jira token after /myself 401", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    const result = await evaluateConnectorFieldCheck({
      type: "jira",
      baseUrl: "https://ex.atlassian.net",
      credentials: { email: "a@b.com", apiToken: "garbage" },
      config: { allProjects: true },
    });
    assert.equal(result.ok, false);
    assert.equal(result.message, JIRA_INVALID_TOKEN);
  });

  it("names a missing URL instead of the lumped create-plan error", async () => {
    const result = await evaluateConnectorFieldCheck({
      type: "jira",
      baseUrl: "",
      credentials: { email: "a@b.com", apiToken: "tok" },
      config: { allProjects: true },
    });
    assert.equal(result.ok, false);
    assert.equal(result.message, JIRA_URL_REQUIRED);
    assert.equal(/at least one project/i.test(result.message), false);
  });

  it("does not treat project-list 200 as proof the token is valid", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/myself")) return new Response("{}", { status: 401 });
      return new Response(JSON.stringify({ values: [{ key: "RD", name: "RD" }], isLast: true }), {
        status: 200,
      });
    }) as typeof fetch;
    const result = await evaluateConnectorFieldCheck({
      type: "jira",
      baseUrl: "https://ex.atlassian.net",
      credentials: { email: "a@b.com", apiToken: "anonymous-ok-on-projects" },
      config: { allProjects: true },
    });
    assert.equal(result.ok, false);
    assert.equal(result.message, JIRA_INVALID_TOKEN);
  });

  it("accepts Jira credentials when /myself returns 200", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      assert.match(String(input), /\/rest\/api\/3\/myself$/);
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const result = await evaluateConnectorFieldCheck({
      type: "jira",
      baseUrl: "https://ex.atlassian.net",
      credentials: { email: "a@b.com", apiToken: "valid-token" },
      config: { allProjects: true },
    });
    assert.equal(result.ok, true);
    assert.equal(result.message, "Jira accepted these credentials.");
  });
});
