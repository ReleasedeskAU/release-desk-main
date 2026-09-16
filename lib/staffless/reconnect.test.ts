import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConnectorTableRow } from "./map-indexing-status";
import {
  RECONNECT_REQUIRED_MESSAGE,
  looksLikeCredentialRejection,
  withReconnectIfCredentialRejected,
} from "./reconnect";

function errorRow(overrides: Partial<ConnectorTableRow> = {}): ConnectorTableRow {
  return {
    id: "7",
    ccPairId: 44,
    credentialIds: [12],
    name: "Jira RD",
    type: "jira",
    authType: "basic_token",
    baseUrl: "https://ex.atlassian.net",
    config: {},
    pollInterval: 15,
    status: "ERROR",
    lastSyncedAt: "2026-09-01T00:00:00Z",
    lastStatus: "failed",
    lastFinishedStatus: "failed",
    lastError: "Last index run failed",
    reconnectRequired: false,
    enabled: true,
    docsIndexed: 10,
    latestAttemptDocsIndexed: null,
    inProgress: false,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    indexingStart: null,
    ...overrides,
  };
}

describe("looksLikeCredentialRejection", () => {
  it("matches 401 and expired/invalid credential wording", () => {
    assert.equal(looksLikeCredentialRejection("Jira credentials are expired or invalid (HTTP 401)."), true);
    assert.equal(looksLikeCredentialRejection("GitHub credential expired"), true);
    assert.equal(looksLikeCredentialRejection("invalid_auth"), true);
    assert.equal(looksLikeCredentialRejection("token_expired"), true);
  });

  it("matches Slack dead-token slugs that are not the invalid-or-revoked phrase", () => {
    assert.equal(looksLikeCredentialRejection("token_revoked"), true);
    assert.equal(looksLikeCredentialRejection("not_authed"), true);
    assert.equal(looksLikeCredentialRejection("account_inactive"), true);
    assert.equal(looksLikeCredentialRejection("Slack bot token was rejected (token_revoked)."), true);
  });

  it("does not treat JQL, 403, missing Slack scope, or generic failures as reconnect", () => {
    assert.equal(looksLikeCredentialRejection("Invalid JQL query. JQL: project = RD"), false);
    assert.equal(looksLikeCredentialRejection("Insufficient permissions (HTTP 403)"), false);
    assert.equal(looksLikeCredentialRejection("Last index run failed"), false);
    assert.equal(looksLikeCredentialRejection("missing_scope"), false);
    assert.equal(
      looksLikeCredentialRejection(
        "This bot cannot read messages. Grant channels:history (and groups:history for private channels), reinstall the Slack app, and invite the bot to each channel you picked."
      ),
      false
    );
    assert.equal(looksLikeCredentialRejection(""), false);
    assert.equal(looksLikeCredentialRejection(null), false);
  });
});

describe("withReconnectIfCredentialRejected", () => {
  it("sets reconnect copy on ERROR rows with a 401 attempt", () => {
    const next = withReconnectIfCredentialRejected(
      errorRow(),
      "Jira credentials are expired or invalid (HTTP 401)."
    );
    assert.equal(next.reconnectRequired, true);
    assert.equal(next.lastError, RECONNECT_REQUIRED_MESSAGE);
    assert.equal(next.lastSyncedAt, "2026-09-01T00:00:00Z");
    assert.equal(next.status, "ERROR");
  });

  it("leaves generic ERROR rows unchanged", () => {
    const row = errorRow();
    const next = withReconnectIfCredentialRejected(row, "Could not reach host");
    assert.equal(next.reconnectRequired, false);
    assert.equal(next.lastError, "Last index run failed");
  });

  it("sets reconnect on Slack token_revoked after sanitization", () => {
    const next = withReconnectIfCredentialRejected(
      errorRow({ type: "slack", name: "Slack social" }),
      "Slack bot token was rejected (token_revoked)."
    );
    assert.equal(next.reconnectRequired, true);
    assert.equal(next.lastError, RECONNECT_REQUIRED_MESSAGE);
    assert.equal(next.status, "ERROR");
  });
});
