import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AskMarkdown } from "@/components/ask/AskMarkdown";
import { ASK_TOOL_DOCUMENT_BY_KEY, ASK_TOOL_GET_VERIFIED_COUNT } from "./ask-tools";
import {
  formatDocumentByKeyAnswer,
  isDocumentOnlyTurn,
  parseDocumentByKeyResult,
  shouldFormatTicketTable,
} from "./ask-format";

const FOUND = {
  found: true as const,
  key: "RD-3",
  title: "RD-3: Jira KT to Kabir and Shiva",
  link: "https://releasedesk-team.atlassian.net/browse/RD-3",
  source: "jira",
  fields: {
    key: "RD-3",
    issuetype: "Task",
    status: "In Progress",
    priority: "Medium",
    assignee: "Suresh Chudoji",
    parent: "RD-90",
    created: "2026-08-04T21:04:50.367+1000",
    updated: "2026-08-23T00:26:54.282+1000",
    assignee_email: "hidden@example.com",
  },
  note: "Exact indexed document lookup by key, not a search ranking.",
};

describe("formatDocumentByKeyAnswer", () => {
  it("renders a Field | Value table from stored fields only", () => {
    const md = formatDocumentByKeyAnswer(FOUND);
    assert.match(md, /### RD-3: Jira KT to Kabir and Shiva/);
    assert.match(md, /\| Field \| Value \|/);
    assert.match(md, /\| Key \| RD-3 \|/);
    assert.match(md, /\| Type \| Task \|/);
    assert.match(md, /\| Status \| In Progress \|/);
    assert.match(md, /\| Parent \| RD-90 \|/);
    assert.match(md, /Open ticket/);
    assert.equal(md.includes("Created"), false);
    assert.equal(md.includes("Updated"), false);
    assert.equal(md.includes("2026-08-04"), false);
    assert.equal(md.includes("hidden@example.com"), false);
    assert.equal(md.includes("The ticket RD-3 is titled"), false);
  });

  it("adds stored custom field lines as extra table rows", () => {
    const md = formatDocumentByKeyAnswer({
      ...FOUND,
      fields: {
        ...FOUND.fields,
        custom_fields: ["Story point estimate: 13", "Team: Platform"],
      },
    });
    assert.match(md, /\| Story point estimate \| 13 \|/);
    assert.match(md, /\| Team \| Platform \|/);
  });

  it("does not invent values when the ticket is missing", () => {
    const md = formatDocumentByKeyAnswer({
      found: false,
      key: "RD-9999",
      source: "jira",
      note: "No indexed document with this exact key.",
    });
    assert.equal(md, "No indexed document with this exact key.");
    assert.equal(md.includes("| Field |"), false);
  });
});

describe("document-only turn", () => {
  it("formats only when the turn is a ticket lookup", () => {
    assert.equal(isDocumentOnlyTurn([ASK_TOOL_DOCUMENT_BY_KEY]), true);
    assert.equal(isDocumentOnlyTurn([ASK_TOOL_DOCUMENT_BY_KEY, ASK_TOOL_GET_VERIFIED_COUNT]), false);
    assert.equal(isDocumentOnlyTurn([]), false);
  });

  it("auto-tables only on a first-turn identity lookup, not follow-ups", () => {
    assert.equal(shouldFormatTicketTable([ASK_TOOL_DOCUMENT_BY_KEY], true), true);
    assert.equal(shouldFormatTicketTable([ASK_TOOL_DOCUMENT_BY_KEY], false), false);
    assert.equal(
      shouldFormatTicketTable([ASK_TOOL_DOCUMENT_BY_KEY, ASK_TOOL_GET_VERIFIED_COUNT], true),
      false
    );
  });

  it("ignores invalid or failed tool payloads", () => {
    assert.equal(parseDocumentByKeyResult("not-json"), null);
    assert.equal(parseDocumentByKeyResult(JSON.stringify({ error: "tool_failed" })), null);
    assert.equal(parseDocumentByKeyResult(JSON.stringify(FOUND))?.key, "RD-3");
  });
});

describe("AskMarkdown ticket table", () => {
  it("renders the formatted ticket as a table, not a paragraph", () => {
    const html = renderToStaticMarkup(
      createElement(AskMarkdown, { content: formatDocumentByKeyAnswer(FOUND) })
    );
    assert.match(html, /<table/);
    assert.match(html, />Key</);
    assert.match(html, />RD-3</);
    assert.match(html, />In Progress</);
    assert.equal(html.includes("<p"), false);
  });
});
