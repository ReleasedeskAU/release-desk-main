import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchSlackChannels, mapSlackChannel, parseSlackChannelNames, savedSlackChannelOptions } from "./fetch-channels";
import { SlackProbeError } from "./probe";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("mapSlackChannel", () => {
  it("keeps member public channels and drops DMs and non-members", () => {
    assert.equal(mapSlackChannel({ name: "ops", is_member: true, is_private: false })?.fullName, "ops");
    assert.equal(mapSlackChannel({ name: "ops", is_private: false })?.fullName, "ops");
    assert.equal(mapSlackChannel({ name: "ops", is_member: false, is_private: false }), null);
    assert.equal(mapSlackChannel({ name: "dm", is_member: true, is_im: true }), null);
    assert.equal(mapSlackChannel({ name: "group", is_member: true, is_mpim: true }), null);
  });
});

describe("parseSlackChannelNames", () => {
  it("strips # and dedupes", () => {
    assert.deepEqual(parseSlackChannelNames(["#ops", "ops", "cab"]), ["ops", "cab"]);
  });
});

describe("savedSlackChannelOptions", () => {
  it("turns saved names into picker rows without a live token", () => {
    const rows = savedSlackChannelOptions(["#social", "social"]);
    assert.deepEqual(
      rows.map((row) => row.fullName),
      ["social"]
    );
    assert.equal(rows[0]?.name, "#social");
  });
});

describe("fetchSlackChannels", () => {
  it("lists member channels and does not request join", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          ok: true,
          channels: [
            { id: "C1", name: "ops", is_private: false },
            { name: "secret", is_member: false, is_private: true },
          ],
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const channels = await fetchSlackChannels("xoxb-example");
    assert.deepEqual(
      channels.map((c) => c.fullName),
      ["ops"]
    );
    assert.equal(urls.some((u) => u.includes("conversations.join")), false);
    assert.ok(urls.some((u) => u.includes("users.conversations")));
    assert.ok(urls.some((u) => u.includes("conversations.history")));
  });

  it("rejects a token that cannot read message history", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("conversations.history")) {
        return new Response(JSON.stringify({ ok: false, error: "missing_scope" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ ok: true, channels: [{ id: "C1", name: "ops", is_private: false }] }),
        { status: 200 }
      );
    }) as typeof fetch;
    await assert.rejects(
      () => fetchSlackChannels("xoxb-example"),
      (err: unknown) =>
        err instanceof SlackProbeError && /cannot read messages/i.test(err.message)
    );
  });

  it("maps list 401 to a credentials error", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), { status: 200 })) as typeof fetch;
    await assert.rejects(
      () => fetchSlackChannels("xoxb-example"),
      (err: unknown) => err instanceof SlackProbeError && /rejected that token/i.test(err.message)
    );
  });
});
