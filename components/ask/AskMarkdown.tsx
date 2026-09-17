"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { dataTableTableClass, tableRow } from "@/components/ui/data-table";
import {
  ASK_TABLE_PREVIEW_ROWS,
  parseAskInline,
  parseAskMarkdown,
  type AskMdBlock,
  type AskMdInline,
} from "@/lib/staffless/ask-markdown";

/**
 * Render Ask assistant markdown with chat-weight typography and tables.
 * Tables keep the shared data-table scrollport (horizontal dividers, overflow)
 * but drop the admin card chrome so ticket lists read like a chat answer.
 */
export function AskMarkdown({ content, className }: { content: string; className?: string }) {
  const blocks = parseAskMarkdown(content);
  return (
    <div className={cn("space-y-5 text-[15px] leading-7", className)}>
      {blocks.map((block, i) => (
        <AskMdBlockView key={`${block.type}-${i}`} block={block} />
      ))}
    </div>
  );
}

function AskMdBlockView({ block }: { block: AskMdBlock }) {
  if (block.type === "heading") {
    const Tag = block.level === 2 ? "h3" : "h4";
    return (
      <Tag className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">
        <AskInline text={block.text} />
      </Tag>
    );
  }
  if (block.type === "list") {
    const List = block.ordered ? "ol" : "ul";
    return (
      <List className="list-none space-y-2.5">
        {block.items.map((item, i) => (
          <li key={i} className="flex gap-3 text-gray-700 dark:text-white/90">
            <span className="w-6 shrink-0 pt-0.5 font-mono text-xs font-semibold tabular-nums text-gray-400 dark:text-white/40">
              {block.ordered ? i + 1 : "•"}
            </span>
            <span className="min-w-0">
              <AskInline text={item.text} />
              {item.nested.length > 0 ? (
                <ul className="mt-1.5 list-none space-y-1">
                  {item.nested.map((nested, ni) => (
                    <li key={ni} className="flex gap-2">
                      <span className="shrink-0 text-gray-400 dark:text-white/40">•</span>
                      <span className="min-w-0">
                        <AskInline text={nested} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </span>
          </li>
        ))}
      </List>
    );
  }
  if (block.type === "code") {
    return (
      <pre className="overflow-x-auto rounded-xl bg-gray-100 px-4 py-3 font-mono text-[13px] leading-6 text-gray-800 dark:bg-white/[0.06] dark:text-white/80">
        {block.text}
      </pre>
    );
  }
  if (block.type === "table") {
    return <AskMdTable headers={block.headers} rows={block.rows} />;
  }
  return (
    <p className="max-w-prose text-gray-700 dark:text-white/90">
      {block.text.split("\n").map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          <AskInline text={line} />
        </span>
      ))}
    </p>
  );
}

function AskMdTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const [expanded, setExpanded] = useState(false);
  const overflow = rows.length > ASK_TABLE_PREVIEW_ROWS;
  const visible = expanded || !overflow ? rows : rows.slice(0, ASK_TABLE_PREVIEW_ROWS);

  return (
    <div className="w-full min-w-0">
      <div className="data-table-body ask-chat-table max-h-80">
        <table className={dataTableTableClass}>
          <thead>
            <tr>
              {headers.map((header, hi) => (
                <th key={`${hi}-${header}`} title={header}>
                  <AskInline text={header} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, ri) => (
              <tr key={ri} className={tableRow}>
                {row.map((cell, ci) => (
                  <td
                    key={`${ri}-${ci}`}
                    className={cn(ci === 0 && "whitespace-nowrap font-mono text-[13px] font-semibold")}
                  >
                    <AskInline text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {overflow && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200"
        >
          {expanded
            ? "Show fewer rows"
            : `Show all ${rows.length} rows (${rows.length - ASK_TABLE_PREVIEW_ROWS} more)`}
        </button>
      )}
    </div>
  );
}

function AskInline({ text }: { text: string }) {
  return <>{parseAskInline(text).map((part, i) => inlineNode(part, i))}</>;
}

function inlineNode(part: AskMdInline, key: number): ReactNode {
  if (part.type === "bold") {
    return (
      <strong key={key} className="font-semibold text-gray-900 dark:text-white">
        {part.text}
      </strong>
    );
  }
  if (part.type === "code") {
    return (
      <code
        key={key}
        className="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[13px] text-brand-700 dark:bg-white/10 dark:text-brand-300"
      >
        {part.text}
      </code>
    );
  }
  if (part.type === "link") {
    return (
      <a
        key={key}
        href={part.href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-brand-600 hover:underline dark:text-brand-400"
      >
        {part.text}
      </a>
    );
  }
  return <span key={key}>{part.text}</span>;
}
