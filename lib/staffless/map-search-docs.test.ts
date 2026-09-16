import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapSearchDocToWorkItem, mapSearchDocsToWorkItems } from "./map-search-docs";
import { summarizeWorkItems } from "@/lib/dependency-impact";

describe("mapSearchDocToWorkItem", () => {
  it("maps Jira metadata onto the existing table columns", () => {
    const row = mapSearchDocToWorkItem({
      document_id: "https://example.atlassian.net/browse/RD-12",
      semantic_identifier: "RD-12: Fix login timeout",
      source_type: "jira",
      updated_at: "2026-09-01T10:00:00Z",
      metadata: {
        key: "RD-12",
        issuetype: "Bug",
        status: "In Progress",
        priority: "High",
        assignee: "Ada Lovelace",
        updated: "2026-09-01T12:00:00Z",
        parent: "RD-1",
      },
    });
    assert.equal(row.externalId, "RD-12");
    assert.equal(row.title, "Fix login timeout");
    assert.equal(row.itemType, "Bug");
    assert.equal(row.status, "In Progress");
    assert.equal(row.priority, "High");
    assert.equal(row.assignee, "Ada Lovelace");
    assert.equal(row.author, null);
    assert.equal(row.statusCategory, null);
    assert.equal(row.releaseCode, null);
    assert.equal(row.source, "Jira");
    assert.equal(row.blockedBy, "RD-1");
    assert.equal(row.updatedAt, "2026-09-01T12:00:00Z");
    assert.equal(row.link, null);
  });

  it("leaves Release empty and falls back when GitHub has no Jira fields", () => {
    const row = mapSearchDocToWorkItem({
      document_id: "https://github.com/org/repo/issues/9",
      semantic_identifier: "9: Bump timeout",
      source_type: "github",
      metadata: { object_type: "PullRequest", state: "open", id: 9, user: "octo" },
    });
    assert.equal(row.externalId, "9");
    assert.equal(row.itemType, "PullRequest");
    assert.equal(row.status, "open");
    assert.equal(row.releaseCode, null);
    assert.equal(row.priority, null);
    assert.equal(row.source, "GitHub");
    assert.equal(row.assignee, "octo");
    assert.equal(row.author, null);
    assert.equal(row.statusCategory, null);
  });

  it("maps status_category=done on a Closed ticket and leaves a Done name unclassifiable without it", () => {
    const closed = mapSearchDocToWorkItem({
      document_id: "RD-1",
      semantic_identifier: "RD-1: Ship",
      source_type: "jira",
      metadata: { key: "RD-1", status: "Closed", status_category: "done" },
    });
    const namedDone = mapSearchDocToWorkItem({
      document_id: "RD-2",
      semantic_identifier: "RD-2: Old",
      source_type: "jira",
      metadata: { key: "RD-2", status: "Done" },
    });
    assert.equal(closed.status, "Closed");
    assert.equal(closed.statusCategory, "done");
    assert.equal(namedDone.status, "Done");
    assert.equal(namedDone.statusCategory, null);
  });

  it("labels Teams and IMAP sources honestly", () => {
    const teams = mapSearchDocToWorkItem({
      document_id: "teams-1",
      semantic_identifier: "Standup notes",
      source_type: "teams",
    });
    const mail = mapSearchDocToWorkItem({
      document_id: "imap-1",
      semantic_identifier: "Release freeze",
      source_type: "imap",
    });
    assert.equal(teams.source, "Microsoft Teams");
    assert.equal(mail.source, "Email (IMAP)");
  });

    it("maps GitLab issue type onto the work-item type column", () => {
    const row = mapSearchDocToWorkItem({
      document_id: "https://gitlab.com/acme/app/-/issues/3",
      semantic_identifier: "test issue 3",
      source_type: "gitlab",
      metadata: {
        type: "ISSUE",
        object_type: "Issue",
        state: "opened",
        status: "opened",
        key: "#3",
        created: "2026-09-15T12:40:50.661+00:00",
        updated: "2026-09-15T12:40:50.661+00:00",
      },
    });
    assert.equal(row.source, "GitLab");
    assert.equal(row.itemType, "Issue");
    assert.equal(row.status, "opened");
    assert.equal(row.externalId, "#3");
    assert.equal(row.createdAt.startsWith("2026-09-15"), true);
    assert.equal(row.assignee, null);
    assert.equal(row.priority, null);
  });

  it("deduplicates the same document_id", () => {
    const rows = mapSearchDocsToWorkItems([
      { document_id: "doc-1", semantic_identifier: "A: one", source_type: "jira", metadata: { key: "A" } },
      { document_id: "doc-1", semantic_identifier: "A: one again", source_type: "jira", metadata: { key: "A" } },
    ]);
    assert.equal(rows.length, 1);
  });

  it("keeps an http Slack permalink and drops javascript links", () => {
    const slack = mapSearchDocToWorkItem({
      document_id: "slack-1",
      semantic_identifier: "hello",
      source_type: "slack",
      link: "https://releasedesk.slack.com/archives/C123/p1",
      metadata: { channel: "social" },
    });
    assert.equal(slack.source, "Slack");
    assert.equal(slack.link, "https://releasedesk.slack.com/archives/C123/p1");
    assert.equal(slack.author, null);
    assert.equal(slack.assignee, null);
    const unsafe = mapSearchDocToWorkItem({
      document_id: "slack-2",
      semantic_identifier: "hi",
      source_type: "slack",
      link: "javascript:alert(1)",
    });
    assert.equal(unsafe.link, null);
  });

  it("maps Slack author from metadata.author and leaves assignee empty", () => {
    const row = mapSearchDocToWorkItem({
      document_id: "C1__1.2",
      semantic_identifier: "Ada in #social: hello",
      source_type: "slack",
      metadata: { channel: "social", author: "Ada Lovelace" },
    });
    assert.equal(row.author, "Ada Lovelace");
    assert.equal(row.assignee, null);
  });
});

describe("summarizeWorkItems category rule", () => {
  it("counts Closed + status_category=done as done, not the status word", () => {
    const summary = summarizeWorkItems([
      { status: "Closed", itemType: "Bug", statusCategory: "done" },
      { status: "To Do", itemType: "Story", statusCategory: "new" },
      { status: "Done", itemType: "Task" },
    ]);
    assert.equal(summary.done, 1);
    assert.equal(summary.open, 1);
    assert.equal(summary.unclassified, 1);
    assert.equal(summary.total, 3);
  });
});
