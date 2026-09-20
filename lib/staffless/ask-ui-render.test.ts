import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AskGroundingBadge } from "@/components/ask/AskGroundingBadge";
import { AskMarkdown } from "@/components/ask/AskMarkdown";
import { ASK_GROUNDING_INDEX, ASK_GROUNDING_INDEX_HINT, ASK_GROUNDING_SEARCH, ASK_PUBLIC_UNAVAILABLE } from "./ask-copy";

function renderBadge(kind: "verified" | "search" | "mixed"): string {
  return renderToStaticMarkup(createElement(AskGroundingBadge, { kind }));
}

describe("Ask trust-signal badges", () => {
  it("renders From index from the catalog path, with a live-system tooltip", () => {
    const html = renderBadge("verified");
    assert.match(html, new RegExp(ASK_GROUNDING_INDEX));
    assert.match(html, new RegExp(ASK_GROUNDING_INDEX_HINT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, /bg-success-50/);
    assert.match(html, /text-success-600/);
    assert.equal(html.includes(ASK_GROUNDING_SEARCH), false);
    assert.equal(html.includes("Verified"), false);
  });

  it("renders a distinct search chip with gray system tokens", () => {
    const html = renderBadge("search");
    assert.match(html, new RegExp(ASK_GROUNDING_SEARCH));
    assert.match(html, /bg-gray-100/);
    assert.match(html, /text-gray-600/);
    assert.equal(html.includes("Verified"), false);
  });

  it("shows both chips when catalog and search were used", () => {
    const html = renderBadge("mixed");
    assert.match(html, new RegExp(ASK_GROUNDING_INDEX));
    assert.match(html, new RegExp(ASK_GROUNDING_SEARCH));
    assert.equal(html.includes("Verified"), false);
  });
});

describe("Ask answer content types", () => {
  it("renders a verified count, a breakdown list, a search paragraph, and failure copy", () => {
    const count = renderToStaticMarkup(
      createElement(AskMarkdown, { content: "There are **100** tickets with status `To Do`." })
    );
    assert.match(count, /<strong[^>]*>100<\/strong>/);
    assert.match(count, /<code[^>]*>To Do<\/code>/);

    const breakdown = renderToStaticMarkup(
      createElement(AskMarkdown, {
        content: "1. To Do — 100\n2. In Progress — 24\n3. Done — 17",
      })
    );
    assert.match(breakdown, /<ol/);
    assert.equal(breakdown.includes("rounded-xl border"), false);
    assert.match(breakdown, />1</);
    assert.match(breakdown, /To Do/);

    const summary = renderToStaticMarkup(
      createElement(AskMarkdown, {
        content: "RD-3 is a Task in Progress assigned to Suresh Chudoji.",
      })
    );
    assert.match(summary, /<p/);
    assert.match(summary, /RD-3/);

    assert.match(ASK_PUBLIC_UNAVAILABLE, /couldn't complete that lookup/i);
  });
});
