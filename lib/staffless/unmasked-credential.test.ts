import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertUnmaskedCredentialJson,
  requiredCredentialField,
  sanitizeListResponse,
  StoredCredentialError,
} from "./unmasked-credential";

const SECRET = "xoxb-live-secret-value-not-for-browser";

describe("assertUnmaskedCredentialJson", () => {
  it("returns plaintext fields", () => {
    assert.deepEqual(assertUnmaskedCredentialJson({ slack_bot_token: SECRET }), {
      slack_bot_token: SECRET,
    });
  });

  it("rejects a masked long token without echoing it", () => {
    assert.throws(
      () => assertUnmaskedCredentialJson({ slack_bot_token: "xoxb...cret" }),
      (err: unknown) => {
        assert.ok(err instanceof StoredCredentialError);
        assert.equal(err.message.includes("xoxb"), false);
        assert.equal(err.message.includes("cret"), false);
        return true;
      }
    );
  });

  it("rejects a bullet-masked short secret", () => {
    assert.throws(
      () => assertUnmaskedCredentialJson({ token: "••••••••••••" }),
      StoredCredentialError
    );
  });
});

describe("sanitizeListResponse", () => {
  it("keeps channel rows and drops a planted secret key", () => {
    const body = sanitizeListResponse({
      channels: [{ fullName: "release-ops" }],
      slack_bot_token: SECRET,
      password: SECRET,
    });
    const encoded = JSON.stringify(body);
    assert.deepEqual(body, { channels: [{ fullName: "release-ops" }] });
    assert.equal(encoded.includes(SECRET), false);
  });
});

describe("requiredCredentialField", () => {
  it("reads one field and refuses a missing one without naming the value", () => {
    assert.equal(requiredCredentialField({ github_access_token: SECRET }, "github_access_token"), SECRET);
    assert.throws(
      () => requiredCredentialField({}, "github_access_token"),
      (err: unknown) => {
        assert.ok(err instanceof StoredCredentialError);
        assert.equal(err.message.includes("github"), false);
        return true;
      }
    );
  });
});
