import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AskMarkdown } from "@/components/ask/AskMarkdown";
import { ASK_TABLE_PREVIEW_ROWS } from "./ask-markdown";

const JIRA_TABLE = `Here are the Jira issues currently in the index:

| Key | Title | Status | Type |
| --- | --- | --- | --- |
| RD-1 | Fix **login** timeout | In Progress | Bug |
| RD-12 | [SSO](https://example.atlassian.net/browse/RD-12) | Open | Story |
`;

function renderAsk(content: string): string {
  return renderToStaticMarkup(createElement(AskMarkdown, { content }));
}

describe("AskMarkdown rendering", () => {
  it("renders a Jira GFM table as HTML, not pipe characters", () => {
    const html = renderAsk(JIRA_TABLE);
    assert.match(html, /<table/);
    assert.match(html, /<thead/);
    assert.match(html, /title="Key"/);
    assert.match(html, />RD-1</);
    assert.match(html, /<strong[^>]*>login<\/strong>/);
    assert.match(html, /href="https:\/\/example\.atlassian\.net\/browse\/RD-12"/);
    assert.equal(html.includes("| --- |"), false);
    assert.equal(/\|\s*Key\s*\|/.test(html), false);
    assert.match(html, /data-table-body/);
    assert.match(html, /ask-chat-table/);
    assert.equal(html.includes("uppercase tracking-wide"), false);
  });

  it("collapses long tables behind Show all", () => {
    const header = "| Key | Title |\n| --- | --- |\n";
    const rows = Array.from({ length: ASK_TABLE_PREVIEW_ROWS + 3 }, (_, i) => `| RD-${i} | Row ${i} |`).join("\n");
    const html = renderAsk(header + rows);
    assert.match(html, /Show all 15 rows/);
    assert.equal((html.match(/<tr[\s>]/g) ?? []).length, ASK_TABLE_PREVIEW_ROWS + 1);
  });

  it("renders lists and leaves raw HTML as text", () => {
    const html = renderAsk("### Notes\n\n- **alpha**\n- beta\n\n<script>alert(1)</script>");
    assert.match(html, /<h4/);
    assert.match(html, /<strong[^>]*>alpha<\/strong>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.equal(html.includes("rounded-xl border"), false);
    assert.match(html, /tabular-nums/);
  });

  it("numbers ordered lists with the same row chrome as tables", () => {
    const html = renderAsk("1. first\n2. second");
    assert.match(html, /<ol/);
    assert.match(html, />1</);
    assert.match(html, />2</);
    assert.match(html, /tabular-nums/);
  });

  it("numbers GitHub View-commit records 1 2 3 instead of repeating 1", () => {
    const html = renderAsk(
      [
        '1. Commit: "website-test added initial README.md"',
        "",
        "[View commit](https://github.com/ReleasedeskAU/website-test/commit/aaa)",
        "",
        '1. Commit: "website-test Add Release Desk marketing site"',
        "",
        "[View commit](https://github.com/ReleasedeskAU/website-test/commit/bbb)",
        "",
        '1. Commit: "website-test Merge pull request #1"',
        "",
        "[View commit](https://github.com/ReleasedeskAU/website-test/commit/ccc)",
      ].join("\n")
    );
    assert.equal((html.match(/<ol/g) ?? []).length, 1);
    assert.match(html, />1</);
    assert.match(html, />2</);
    assert.match(html, />3</);
    assert.match(html, /View commit/);
  });

  it("numbers split 1. records 1 2 3 instead of repeating 1", () => {
    const html = renderAsk(
      "1. **BN-14: Today's work**\n- Assignee: Kiran\n\n1. **BN-19: Shared connector**\n- Assignee: Kabir\n\n1. **BN-20: Testing**\n- Priority: High"
    );
    assert.equal((html.match(/<ol/g) ?? []).length, 1);
    assert.match(html, />1</);
    assert.match(html, />2</);
    assert.match(html, />3</);
    assert.match(html, /BN-14/);
    assert.match(html, /Assignee: Kiran/);
  });
});
