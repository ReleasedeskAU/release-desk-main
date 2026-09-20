import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAskInline, parseAskMarkdown } from "./ask-markdown";

const JIRA_TABLE = `Here are the Jira issues currently in the index:

| Key | Title | Status | Type |
| --- | --- | --- | --- |
| RD-1 | Fix **login** timeout | In Progress | Bug |
| RD-12 | [SSO](https://example.atlassian.net/browse/RD-12) | Open | Story |
`;

describe("parseAskMarkdown tables", () => {
  it("parses a GFM pipe table into headers and rows", () => {
    const blocks = parseAskMarkdown(JIRA_TABLE);
    const table = blocks.find((b) => b.type === "table");
    assert.equal(blocks[0]?.type, "paragraph");
    assert.ok(table && table.type === "table");
    if (table.type !== "table") throw new Error("expected table");
    assert.deepEqual(table.headers, ["Key", "Title", "Status", "Type"]);
    assert.equal(table.rows.length, 2);
    assert.equal(table.rows[0]?.[0], "RD-1");
    assert.equal(table.rows[1]?.[1], "[SSO](https://example.atlassian.net/browse/RD-12)");
  });

  it("parses header rows without outer pipes", () => {
    const blocks = parseAskMarkdown("Key | Title\n--- | ---\nRD-1 | Login\n");
    const table = blocks.find((b) => b.type === "table");
    assert.ok(table && table.type === "table");
    if (table.type !== "table") throw new Error("expected table");
    assert.deepEqual(table.headers, ["Key", "Title"]);
    assert.deepEqual(table.rows[0], ["RD-1", "Login"]);
  });

  it("keeps an incomplete table as a paragraph while streaming", () => {
    const blocks = parseAskMarkdown("| Key | Title |\n| RD-1 | Login |");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "paragraph");
    assert.match((blocks[0] as { text: string }).text, /\| Key \|/);
  });
});

describe("parseAskMarkdown prose", () => {
  it("parses headings, lists, fences, and bold/code/links", () => {
    const blocks = parseAskMarkdown(
      "### Summary\n\n- first\n- second\n\nUse **bold** and `RD-1` and [doc](https://example.com/x).\n\n```\ncode\n```\n"
    );
    assert.equal(blocks[0]?.type, "heading");
    assert.equal(blocks[1]?.type, "list");
    if (blocks[1]?.type !== "list") throw new Error("expected list");
    assert.equal(blocks[1].items[0]?.text, "first");
    assert.equal(blocks[2]?.type, "paragraph");
    assert.equal(blocks[3]?.type, "code");
    const inline = parseAskInline("Use **bold** and `RD-1` and [doc](https://example.com/x).");
    assert.deepEqual(
      inline.map((p) => p.type),
      ["text", "bold", "text", "code", "text", "link", "text"]
    );
  });

  it("does not treat javascript: as a link and leaves HTML as text", () => {
    const bad = parseAskInline("[x](javascript:alert(1))");
    assert.equal(bad[0]?.type, "text");
    const html = parseAskMarkdown("<script>alert(1)</script>");
    assert.equal(html[0]?.type, "paragraph");
    if (html[0]?.type !== "paragraph") throw new Error("expected paragraph");
    assert.equal(html[0].text, "<script>alert(1)</script>");
  });

  it("keeps numbered records as one list when each starts at 1 and has field bullets", () => {
    const blocks = parseAskMarkdown(
      [
        "Here are the tasks in the Jira source:",
        "",
        "1. **BN-14: Today's work**",
        "- Assignee: Kiran Reddy",
        "- Status: In Review",
        "- [Open Ticket](https://example.atlassian.net/browse/BN-14)",
        "",
        "1. **BN-19: Shared connector**",
        "- Assignee: Mohd Kabir",
        "",
        "1. **BN-20: Shared connector testing**",
        "- Priority: High",
      ].join("\n")
    );
    const lists = blocks.filter((b) => b.type === "list");
    assert.equal(lists.length, 1);
    const list = lists[0];
    if (list?.type !== "list") throw new Error("expected ordered list");
    assert.equal(list.ordered, true);
    assert.equal(list.items.length, 3);
    assert.equal(list.items[0]?.text, "**BN-14: Today's work**");
    assert.deepEqual(list.items[0]?.nested, [
      "Assignee: Kiran Reddy",
      "Status: In Review",
      "[Open Ticket](https://example.atlassian.net/browse/BN-14)",
    ]);
    assert.equal(list.items[1]?.text, "**BN-19: Shared connector**");
    assert.equal(list.items[2]?.text, "**BN-20: Shared connector testing**");
  });

  it("keeps GitHub 1. commit records as one list when View commit is a lone link", () => {
    const blocks = parseAskMarkdown(
      [
        "Here are some of the commit messages from ReleasedeskAU/website-test:",
        "",
        '1. Commit: "website-test added initial README.md for website-test project"',
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
    const lists = blocks.filter((b) => b.type === "list");
    assert.equal(lists.length, 1);
    const list = lists[0];
    if (list?.type !== "list") throw new Error("expected ordered list");
    assert.equal(list.ordered, true);
    assert.equal(list.items.length, 3);
    assert.match(list.items[0]?.text ?? "", /initial README/);
    assert.deepEqual(list.items[0]?.nested, [
      "[View commit](https://github.com/ReleasedeskAU/website-test/commit/aaa)",
    ]);
    assert.match(list.items[1]?.text ?? "", /marketing site/);
    assert.match(list.items[2]?.text ?? "", /Merge pull request/);
  });

  it("does not glue two 1. lists across a prose sentence", () => {
    const blocks = parseAskMarkdown(
      "1. First record\n\nThose were last week's commits.\n\n1. Unrelated later record"
    );
    const lists = blocks.filter((b) => b.type === "list" && b.ordered);
    assert.equal(lists.length, 2);
    assert.equal(lists[0]?.type === "list" && lists[0].items.length, 1);
    assert.equal(lists[1]?.type === "list" && lists[1].items.length, 1);
  });

  it("starts numbering over after a heading between two lists", () => {
    const blocks = parseAskMarkdown("## Open\n\n1. BN-1\n\n## Closed\n\n1. BN-2");
    const lists = blocks.filter((b) => b.type === "list" && b.ordered);
    assert.equal(lists.length, 2);
    assert.equal(lists[0]?.type === "list" && lists[0].items.length, 1);
    assert.equal(lists[1]?.type === "list" && lists[1].items.length, 1);
  });
});
