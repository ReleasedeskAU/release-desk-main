import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findRowByStafflessId, parseStafflessId, requireCcPairId, StafflessIdError } from "./ids";
import { mapIndexAttempt, mapIndexAttemptPage, plainIndexErrorMessage } from "./map-index-attempts";
import type { ConnectorTableRow } from "./map-indexing-status";
import { mergeCcPairsWithIndexingStatus } from "./map-indexing-status";
import {
  buildSyncLogsView,
  lastResultFromRow,
  lastResultLabel,
  shouldPollSyncLogs,
} from "./map-sync-logs";

function sampleRow(overrides: Partial<ConnectorTableRow> = {}): ConnectorTableRow {
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
    status: "CONNECTED",
    lastSyncedAt: "2026-09-01T00:00:00Z",
    lastStatus: "success",
    lastFinishedStatus: "success",
    lastError: null,
    enabled: true,
    docsIndexed: 31,
    latestAttemptDocsIndexed: 4,
    inProgress: false,
    createdBy: null,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    indexingStart: null,
    ...overrides,
  };
}

describe("findRowByStafflessId", () => {
  it("prefers StaffLess connector id over a colliding cc_pair_id", () => {
    const rows = [
      sampleRow({ id: "9", ccPairId: 7, name: "Other" }),
      sampleRow({ id: "7", ccPairId: 44, name: "Jira RD" }),
    ];
    assert.equal(findRowByStafflessId(rows, "7")?.name, "Jira RD");
    assert.equal(findRowByStafflessId(rows, "44")?.name, "Jira RD");
  });

  it("returns null for a Prisma-style id", () => {
    assert.equal(parseStafflessId("clxyz0123456789abcdefghij"), null);
    assert.equal(findRowByStafflessId([sampleRow()], "clxyz0123456789abcdefghij"), null);
  });
});

describe("buildSyncLogsView", () => {
  it("maps real StaffLess counts on a successful run", () => {
    const view = buildSyncLogsView({
      connector: sampleRow(),
      attempts: {
        items: [
          {
            id: 9,
            status: "success",
            fromBeginning: false,
            newDocsIndexed: 2,
            totalDocsIndexed: 4,
            docsRemoved: 0,
            errorMsg: null,
            errorCount: 0,
            timeStarted: "2026-09-01T00:00:00Z",
            timeUpdated: "2026-09-01T00:01:00Z",
          },
        ],
        total: 1,
      },
      errors: { items: [], total: 0 },
    });
    assert.equal(view.summary.docsIndexed, 31);
    assert.equal(view.summary.latestAttemptDocsIndexed, 4);
    assert.equal(view.summary.newDocsIndexed, 2);
    assert.equal(view.summary.lastResult, "success");
    assert.equal(view.summary.errorCount, 0);
    assert.equal(view.summary.inProgress, false);
    assert.equal(shouldPollSyncLogs(view.summary), false);
    assert.equal(lastResultLabel(view.summary.lastResult), "Succeeded");
    assert.equal("recordsFound" in view.summary, false);
    assert.equal("fetched" in view.summary, false);
  });

  it("keeps empty history honest and does not poll", () => {
    const view = buildSyncLogsView({
      connector: sampleRow({
        docsIndexed: 0,
        latestAttemptDocsIndexed: null,
        lastSyncedAt: null,
        lastStatus: null,
        lastFinishedStatus: null,
        inProgress: false,
        status: "PENDING",
      }),
      attempts: { items: [], total: 0 },
      errors: { items: [], total: 0 },
    });
    assert.equal(view.summary.lastResult, "pending");
    assert.equal(view.summary.latestAttemptDocsIndexed, null);
    assert.equal(view.summary.newDocsIndexed, null);
    assert.equal(view.summary.lastSyncAt, null);
    assert.equal(view.attempts.length, 0);
    assert.equal(shouldPollSyncLogs(view.summary), false);
  });

  it("treats in-progress and queued runs as live", () => {
    const running = buildSyncLogsView({
      connector: sampleRow({
        inProgress: true,
        lastStatus: "in_progress",
        lastFinishedStatus: "success",
        latestAttemptDocsIndexed: 6,
        status: "PENDING",
      }),
      attempts: {
        items: [
          {
            id: 11,
            status: "in_progress",
            fromBeginning: false,
            newDocsIndexed: 3,
            totalDocsIndexed: 6,
            docsRemoved: 0,
            errorMsg: null,
            errorCount: 0,
            timeStarted: "2026-09-08T00:00:00Z",
            timeUpdated: "2026-09-08T00:02:00Z",
          },
        ],
        total: 1,
      },
      errors: { items: [], total: 0 },
    });
    assert.equal(running.summary.lastResult, "in_progress");
    assert.equal(running.summary.inProgress, true);
    assert.equal(running.summary.latestAttemptDocsIndexed, 6);
    assert.equal(shouldPollSyncLogs(running.summary), true);

    const queued = lastResultFromRow(sampleRow({ inProgress: false, lastStatus: "not_started" }));
    assert.equal(queued, "not_started");
    assert.equal(
      shouldPollSyncLogs({
        docsIndexed: 0,
        latestAttemptDocsIndexed: 0,
        newDocsIndexed: 0,
        inProgress: false,
        lastSyncAt: null,
        lastResult: "not_started",
        errorCount: 0,
        lastError: null,
      }),
      true
    );
  });

  it("uses unresolved error count and a plain-language message", () => {
    const view = buildSyncLogsView({
      connector: sampleRow({
        lastStatus: "failed",
        lastFinishedStatus: "failed",
        lastError: "Last index run failed",
        status: "ERROR",
      }),
      attempts: {
        items: [
          {
            id: 3,
            status: "failed",
            fromBeginning: false,
            newDocsIndexed: 0,
            totalDocsIndexed: 0,
            docsRemoved: 0,
            errorMsg: "Could not reach Jira",
            errorCount: 2,
            timeStarted: "2026-09-08T00:00:00Z",
            timeUpdated: "2026-09-08T00:01:00Z",
          },
        ],
        total: 1,
      },
      errors: {
        items: [
          {
            id: 1,
            failureMessage: "Could not reach Jira",
            isResolved: false,
            timeCreated: "2026-09-08T00:01:00Z",
            documentId: "RD-1",
          },
        ],
        total: 2,
      },
    });
    assert.equal(view.summary.lastResult, "failed");
    assert.equal(view.summary.errorCount, 2);
    assert.equal(view.summary.lastError, "Could not reach Jira");
    assert.ok(!JSON.stringify(view).includes("Traceback"));
  });

  it("skips a malformed attempt page instead of inventing rows", () => {
    const page = mapIndexAttemptPage({ items: [{ status: "failed" }, null, "x"], total_items: 3 });
    assert.equal(page.items.length, 0);
    const view = buildSyncLogsView({
      connector: sampleRow({ latestAttemptDocsIndexed: null }),
      attempts: page,
      errors: { items: [], total: 0 },
    });
    assert.equal(view.attempts.length, 0);
    assert.equal(view.summary.latestAttemptDocsIndexed, null);
  });
});

describe("requireCcPairId", () => {
  it("refuses a missing cc-pair instead of querying Prisma", () => {
    assert.throws(() => requireCcPairId(null), StafflessIdError);
    assert.throws(() => requireCcPairId(undefined), StafflessIdError);
  });
});

describe("plainIndexErrorMessage", () => {
  it("drops a Python traceback and keeps the first line", () => {
    const msg = plainIndexErrorMessage(
      "Could not reach Jira\nTraceback (most recent call last):\n  File \"foo.py\", line 1"
    );
    assert.equal(msg, "Could not reach Jira");
  });

  it("replaces Slack conversations.join SDK text with a named message", () => {
    const msg = plainIndexErrorMessage(
      "The request to the Slack API failed. (url: https://slack.com/api/conversations.join)"
    );
    assert.equal(
      msg,
      "Slack could not join that channel. Invite the bot to private channels, or grant the bot the channels:join scope for public channels."
    );
    assert.ok(msg && !msg.includes("slack.com"));
  });

  it("maps Slack users.info SDK text to a bot-scope message", () => {
    const msg = plainIndexErrorMessage(
      "The request to the Slack API failed. (url: https://slack.com/api/users.info)"
    );
    assert.match(msg ?? "", /users:read/i);
    assert.ok(msg && !msg.includes("slack.com"));
  });

  it("keeps a Slack dead-token slug instead of rewriting to join/history copy", () => {
    const historyAuth = plainIndexErrorMessage(
      "The request to the Slack API failed. (url: https://slack.com/api/conversations.history) {'ok': False, 'error': 'invalid_auth'}"
    );
    assert.equal(historyAuth, "Slack bot token was rejected (invalid_auth).");
    const joinRevoked = plainIndexErrorMessage(
      "The request to the Slack API failed. (url: https://slack.com/api/conversations.join) error=token_revoked"
    );
    assert.equal(joinRevoked, "Slack bot token was rejected (token_revoked).");
    const genericRevoked = plainIndexErrorMessage(
      "The request to the Slack API failed.\nThe server responded with: {'ok': False, 'error': 'not_authed'}"
    );
    assert.equal(genericRevoked, "Slack bot token was rejected (not_authed).");
  });

  it("still maps missing_scope history failures to the read-messages message", () => {
    const msg = plainIndexErrorMessage(
      "The request to the Slack API failed. (url: https://slack.com/api/conversations.history) error=missing_scope"
    );
    assert.match(msg ?? "", /channels:history/i);
    assert.ok(msg && !msg.includes("invalid_auth") && !msg.includes("token_revoked"));
  });
});

describe("mapIndexAttempt stack traces", () => {
  it("still drops full_exception_trace on a failed attempt", () => {
    const mapped = mapIndexAttempt({
      id: 9,
      status: "failed",
      error_msg: "Index failed\nTraceback (most recent call last):\nboom",
      full_exception_trace: "Traceback (most recent call last)",
      total_docs_indexed: 3,
    });
    assert.equal(mapped?.errorMsg, "Index failed");
    assert.ok(!JSON.stringify(mapped).includes("Traceback"));
  });
});

describe("mergeCcPairsWithIndexingStatus latest attempt docs", () => {
  it("copies latest_index_attempt_docs_indexed from indexing-status", () => {
    const rows = mergeCcPairsWithIndexingStatus(
      [
        {
          cc_pair_id: 44,
          name: "Jira RD",
          connector: { id: 7, name: "Jira RD", source: "jira", credential_ids: [12] },
        },
      ],
      [
        {
          cc_pair_id: 44,
          last_status: "in_progress",
          last_finished_status: "success",
          docs_indexed: 31,
          latest_index_attempt_docs_indexed: 6,
          in_progress: true,
        },
      ]
    );
    assert.equal(rows[0].latestAttemptDocsIndexed, 6);
    assert.equal(rows[0].lastStatus, "in_progress");
    assert.equal(rows[0].inProgress, true);
  });
});
