/**
 * Historical Ask eval runner.
 * Hits the same gpt-4o tool loop as production. Prompt is an argument so later
 * comparisons can reuse this without assuming a single swap.
 *
 * Usage:
 *   npx tsx scripts/ask-eval/run.ts --label baseline
 *   npx tsx scripts/ask-eval/run.ts --label candidate --system candidate
 *
 * Env: OPENAI_API_KEY plus StaffLess credentials from Sentinel/.env.
 * Never prints tokens. Traces on disk are truncated.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";
import { ASK_AGENT_SYSTEM } from "../../lib/staffless/ask-copy";
import { ASK_CANDIDATE_SYSTEM } from "./candidate-system";
import { ASK_OPENAI_MAX_RETRIES, completeAskWithTools, type AskToolTraceCall } from "../../lib/staffless/ask-agent";
import { listStafflessConnectors } from "../../lib/staffless/api";
import { askGroundingFromTools } from "../../lib/staffless/ask-grounding";
import { formatAskSourceInventory, uniqueAskSources, type AskIndexedSource } from "../../lib/staffless/ask-source";
import { ASK_PUBLIC_UNAVAILABLE } from "../../lib/staffless/ask-errors";
import { loadBenchmarkEnv } from "../jira-ask-benchmark/env";
import { selectAskEvalCases, skipReasonForSource } from "./cases";
import { scoreAskEvalTurn } from "./score";
import type { AskEvalCase, AskEvalCaseId, AskEvalRun } from "./types";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const OUTPUT_DIR = resolve(REPO_ROOT, "scripts/ask-eval-output");
const RESULT_PREVIEW_CHARS = 400;

type Cli = {
  label: string;
  systemPath: string | null;
  runs: number;
  caseIds: string[];
};

/**
 * Parse argv for the eval runner. Unknown flags throw.
 */
function parseCli(argv: string[]): Cli {
  const out: Cli = { label: "baseline", systemPath: null, runs: 5, caseIds: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--label" && next) {
      out.label = next;
      i += 1;
      continue;
    }
    if (arg === "--system" && next) {
      out.systemPath = next === "current" ? null : next;
      i += 1;
      continue;
    }
    if (arg === "--runs" && next) {
      const n = Number(next);
      if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error("--runs must be 1..20");
      out.runs = n;
      i += 1;
      continue;
    }
    if (arg === "--cases" && next) {
      out.caseIds = next.split(",").map((id) => id.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }
  return out;
}

/**
 * Load ASK_AGENT_SYSTEM, or a prompt file for a later candidate comparison.
 */
function loadSystemPrompt(systemPath: string | null): { source: string; text: string } {
  if (!systemPath) return { source: "current", text: ASK_AGENT_SYSTEM };
  if (systemPath === "candidate") return { source: "candidate", text: ASK_CANDIDATE_SYSTEM };
  const abs = resolve(REPO_ROOT, systemPath);
  return { source: abs, text: readFileSync(abs, "utf8") };
}

function compactCall(call: AskToolTraceCall): AskToolTraceCall {
  const result =
    call.result.length <= RESULT_PREVIEW_CHARS
      ? call.result
      : `${call.result.slice(0, RESULT_PREVIEW_CHARS)}…`;
  return { round: call.round, name: call.name, arguments: call.arguments, result };
}

async function runOne(opts: {
  openai: OpenAI;
  systemPrompt: string;
  sources: AskIndexedSource[];
  spec: AskEvalCase;
  n: number;
}): Promise<AskEvalRun> {
  const started = Date.now();
  try {
    const messages = [
      { role: "system" as const, content: `${opts.systemPrompt}\n\n${formatAskSourceInventory(opts.sources)}` },
      { role: "user" as const, content: opts.spec.question },
    ];
    const out = await completeAskWithTools(opts.openai, messages, {
      allowTicketTable: true,
      indexedSources: opts.sources,
      userQuestion: opts.spec.question,
    });
    const scored = scoreAskEvalTurn(opts.spec.id, out.text, out.calls);
    return {
      id: opts.spec.id,
      n: opts.n,
      question: opts.spec.question,
      outcome: scored.outcome,
      reason: scored.reason,
      grounding: askGroundingFromTools(out.tools),
      tools: out.tools,
      calls: out.calls.map(compactCall),
      text: out.text,
      duration_ms: Date.now() - started,
    };
  } catch (err) {
    const kind = err instanceof Error ? err.name : "unknown";
    return {
      id: opts.spec.id,
      n: opts.n,
      question: opts.spec.question,
      outcome: "infra",
      reason: `thrown:${kind}`,
      grounding: null,
      tools: [],
      calls: [],
      text: ASK_PUBLIC_UNAVAILABLE,
      duration_ms: Date.now() - started,
      error: kind,
    };
  }
}

function summarize(runs: AskEvalRun[], caseIds: AskEvalCaseId[]) {
  return caseIds.map((id) => {
    const rows = runs.filter((r) => r.id === id);
    const skip = rows.filter((r) => r.outcome === "skip").length;
    const infra = rows.filter((r) => r.outcome === "infra").length;
    const scored = rows.filter((r) => r.outcome === "pass" || r.outcome === "fail");
    const pass = scored.filter((r) => r.outcome === "pass").length;
    const fail = scored.filter((r) => r.outcome === "fail").length;
    const denom = pass + fail;
    return {
      id,
      pass,
      fail,
      infra,
      skip,
      pass_rate: denom === 0 ? null : `${pass}/${denom}`,
      reasons: rows.map((r) => r.reason),
    };
  });
}

async function main(): Promise<void> {
  loadBenchmarkEnv(REPO_ROOT);
  const cli = parseCli(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error("OPENAI_API_KEY is not set");
    process.exit(1);
  }
  const system = loadSystemPrompt(cli.systemPath);
  const cases = selectAskEvalCases(cli.caseIds);
  const sources = uniqueAskSources(await listStafflessConnectors());
  const openai = new OpenAI({ apiKey, maxRetries: ASK_OPENAI_MAX_RETRIES });

  const runs: AskEvalRun[] = [];
  for (const spec of cases) {
    const skip = skipReasonForSource(spec.requiresSource, sources);
    if (skip) {
      runs.push({
        id: spec.id,
        n: 0,
        question: spec.question,
        outcome: "skip",
        reason: skip,
        grounding: null,
        tools: [],
        calls: [],
        text: "",
        duration_ms: 0,
      });
      console.log(JSON.stringify({ id: spec.id, outcome: "skip", reason: skip }));
      continue;
    }
    for (let n = 1; n <= cli.runs; n += 1) {
      const row = await runOne({ openai, systemPrompt: system.text, sources, spec, n });
      runs.push(row);
      console.log(
        JSON.stringify({
          id: row.id,
          n: row.n,
          outcome: row.outcome,
          reason: row.reason,
          grounding: row.grounding,
          tools: row.tools,
          duration_ms: row.duration_ms,
        })
      );
    }
  }

  const summary = summarize(
    runs,
    cases.map((c) => c.id)
  );
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = resolve(OUTPUT_DIR, `${cli.label}-${stamp}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        label: cli.label,
        system: system.source,
        runs_each: cli.runs,
        sources: sources.map((s) => ({ id: s.id, docsIndexed: s.docsIndexed })),
        summary,
        runs,
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(JSON.stringify({ summary, outPath }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "eval_failed");
  process.exit(1);
});
