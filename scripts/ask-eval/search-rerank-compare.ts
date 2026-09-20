/**
 * Hybrid POST /api/admin/search for every Ask eval case, 5x.
 * Scores fixture-document rank. Does not run the Ask LLM loop.
 *
 * Usage: npx tsx scripts/ask-eval/search-rerank-compare.ts --label on
 * Env: STAFFLESS_AI_URL + STAFFLESS_AI_PAT from Sentinel/.env
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stafflessFetch } from "../../lib/staffless/client";
import type { StafflessSearchDoc } from "../../lib/staffless/map-search-docs";
import { loadBenchmarkEnv } from "../jira-ask-benchmark/env";
import { selectSearchEvalCases } from "./cases";
import { scoreSearchRank } from "./search-score";
import type { SearchEvalCaseId } from "./types";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const OUTPUT_DIR = resolve(REPO_ROOT, "scripts/ask-eval-output");

type Cli = { label: string; runs: number; caseIds: string[] };

type HitSummary = {
  document_id: string;
  semantic_identifier: string;
  source_type: string;
};

type Trial = {
  id: SearchEvalCaseId;
  n: number;
  ms: number;
  status: number;
  count: number;
  kind: string;
  top1: boolean | null;
  top3: boolean | null;
  top10: boolean | null;
  rank: number | null;
  reason: string;
  top: HitSummary | null;
};

/**
 * Parse argv. Unknown flags throw.
 */
function parseCli(argv: string[]): Cli {
  const out: Cli = { label: "run", runs: 5, caseIds: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--label" && next) {
      out.label = next;
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

function summarize(doc: StafflessSearchDoc | undefined): HitSummary | null {
  if (!doc) return null;
  return {
    document_id: (doc.document_id || "").slice(0, 120),
    semantic_identifier: (doc.semantic_identifier || "").slice(0, 80),
    source_type: doc.source_type || "",
  };
}

/**
 * One hybrid admin search. Empty filters — same raw question the case uses.
 */
async function hybridSearch(query: string): Promise<{
  status: number;
  ms: number;
  documents: StafflessSearchDoc[];
}> {
  const started = Date.now();
  try {
    const body = await stafflessFetch<{ documents?: StafflessSearchDoc[] }>(
      "/api/admin/search",
      {
        json: { query, filters: {}, retrieval: "hybrid" },
        timeoutMs: 45_000,
      }
    );
    return {
      status: 200,
      ms: Date.now() - started,
      documents: Array.isArray(body.documents) ? body.documents : [],
    };
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status: unknown }).status) || 0
        : 0;
    return { status, ms: Date.now() - started, documents: [] };
  }
}

function rates(trials: Trial[], key: "top1" | "top3" | "top10"): string {
  const applicable = trials.filter((t) => t[key] !== null);
  if (applicable.length === 0) return "n/a";
  const pass = applicable.filter((t) => t[key] === true).length;
  return `${pass}/${applicable.length}`;
}

async function main(): Promise<void> {
  loadBenchmarkEnv(REPO_ROOT);
  const cli = parseCli(process.argv.slice(2));
  const cases = selectSearchEvalCases(cli.caseIds);
  const trials: Trial[] = [];

  for (const row of cases) {
    const id = row.kind === "ask" ? row.ask.id : row.pair.id;
    const question = row.kind === "ask" ? row.ask.question : row.pair.question;
    const pair = row.kind === "time_pair" ? row.pair : undefined;
    for (let n = 1; n <= cli.runs; n += 1) {
      const hit = await hybridSearch(question);
      const scored =
        hit.status === 200
          ? scoreSearchRank(id, hit.documents, pair)
          : {
              kind: "identity" as const,
              top1: false,
              top3: false,
              top10: false,
              rank: null,
              reason: `http_${hit.status || "error"}`,
            };
      const trial: Trial = {
        id,
        n,
        ms: hit.ms,
        status: hit.status,
        count: hit.documents.length,
        kind: scored.kind,
        top1: scored.top1,
        top3: scored.top3,
        top10: scored.top10,
        rank: scored.rank,
        reason: scored.reason,
        top: summarize(hit.documents[0]),
      };
      trials.push(trial);
      console.log(
        JSON.stringify({
          label: cli.label,
          id: trial.id,
          n: trial.n,
          ms: trial.ms,
          status: trial.status,
          top1: trial.top1,
          rank: trial.rank,
          reason: trial.reason,
          top_source: trial.top?.source_type ?? null,
          top_id: trial.top?.semantic_identifier ?? null,
        })
      );
    }
  }

  const byId = new Map<SearchEvalCaseId, Trial[]>();
  for (const trial of trials) {
    const list = byId.get(trial.id) ?? [];
    list.push(trial);
    byId.set(trial.id, list);
  }
  const summary = [...byId.entries()].map(([id, rows]) => ({
    id,
    kind: rows[0]?.kind,
    top1: rates(rows, "top1"),
    top3: rates(rows, "top3"),
    top10: rates(rows, "top10"),
    ranks: rows.map((r) => r.rank),
    median_ms: [...rows].sort((a, b) => a.ms - b.ms)[Math.floor(rows.length / 2)]?.ms ?? 0,
    top_ids: [...new Set(rows.map((r) => r.top?.semantic_identifier || ""))],
  }));

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = resolve(OUTPUT_DIR, `search-rerank-${cli.label}.json`);
  writeFileSync(
    outPath,
    JSON.stringify({ label: cli.label, at: new Date().toISOString(), summary, trials }, null, 2)
  );
  console.log(JSON.stringify({ wrote: outPath, summary }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "search-rerank-compare failed");
  process.exit(1);
});
