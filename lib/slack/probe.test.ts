import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { evaluateConnectorFieldCheck } from "@/lib/connectors/check-fields";
import { localWizardFieldCheckError } from "@/lib/connectors/wizard-field-check";
import {
  SLACK_BOT_TOKEN_REQUIRED,
  SLACK_INVALID_TOKEN,
  SLACK_TOKEN_REQUIRED,
  SlackProbeError,
  assertSlackTokenReachable,
} from "./probe";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("assertSlackTokenReachable", () => {
  it("rejects a blank token without calling Slack", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await assert.rejects(() => assertSlackTokenReachable("  "), SlackProbeError);
    assert.equal(called, false);
  });

  it("rejects a user token without calling Slack", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await assert.rejects(
      () => assertSlackTokenReachable("xoxp-user"),
      (err: unknown) => err instanceof SlackProbeError && err.message === SLACK_BOT_TOKEN_REQUIRED
    );
    assert.equal(called, false);
  });

  it("maps Slack auth.test ok:false to an invalid-token message", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), { status: 200 })) as typeof fetch;
    await assert.rejects(
      () => assertSlackTokenReachable("xoxb-example"),
      (err: unknown) =>
        err instanceof SlackProbeError && err.message === SLACK_INVALID_TOKEN && !err.message.includes("invalid_auth")
    );
  });

  it("accepts Slack auth.test ok", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
    await assertSlackTokenReachable("xoxb-example");
  });
});

describe("evaluateConnectorFieldCheck slack", () => {
  it("accepts a token Slack accepts", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
    const result = await evaluateConnectorFieldCheck({
      type: "slack",
      credentials: { token: "xoxb-example" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.message, "Slack accepted this token.");
  });

  it("names a missing bot token without calling Slack", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const result = await evaluateConnectorFieldCheck({
      type: "slack",
      credentials: { token: "" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.message, SLACK_TOKEN_REQUIRED);
    assert.equal(called, false);
  });
});

describe("localWizardFieldCheckError", () => {
  it("names both Slack fields when display name and token are blank", () => {
    const result = localWizardFieldCheckError({
      type: "slack",
      name: "  ",
      credentials: { token: "" },
    });
    assert.equal(result?.ok, false);
    assert.equal(result?.message, "Enter a display name and a Slack bot token.");
  });

  it("names a missing Slack bot token when the display name is present", () => {
    const result = localWizardFieldCheckError({
      type: "slack",
      name: "slack",
      credentials: { token: "  " },
    });
    assert.equal(result?.ok, false);
    assert.equal(result?.message, SLACK_TOKEN_REQUIRED);
  });
});
