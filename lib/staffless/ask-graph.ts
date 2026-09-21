/**
 * Stage 1 stored-edge traversal for Ask (Jira tags only).
 *
 * Reads relationships from already-indexed catalog tags — `parent` and
 * `issuelink`/`issuelink_type` — via the exact catalog APIs, never from
 * ranked search. No new infrastructure: this is the traversal layer with a
 * store seam (`GraphFetchers`) so a Neo4j-backed projector can replace the
 * live-catalog fetchers later without changing the tool interface.
 *
 * Grounding contract: every edge returned was stored as a tag. Absence of an
 * edge means "not recorded," never "doesn't exist." LINKS_TO is undirected —
 * stored tags carry no direction, so none is invented.
 */

import {
  getDocumentByKey,
  listDocumentsMatching,
  type DocumentByKeyResult,
  type DocumentListResult,
} from "@/lib/staffless/ask-catalog";
import { ASK_SOURCE_ALL } from "@/lib/staffless/ask-source";
import { StafflessConfigError } from "@/lib/staffless/client";

/** Hard caps — bound what one model call can traverse. */
export const GRAPH_MAX_DEPTH = 3;
export const GRAPH_MAX_SEEDS = 10;
export const GRAPH_MAX_VISITED = 60;

export type GraphRelation = "CHILD_OF" | "LINKS_TO";
export type LinkedRelation = "children" | "parent_chain" | "linked";
export type ClosureDirection = "upstream" | "downstream";

export type StoredEdge = {
  from_key: string;
  to_key: string;
  relation: GraphRelation;
  /** Verbatim stored `issuelink_type` value. Null for CHILD_OF. */
  link_kind: string | null;
  /** 1-based discovery depth from the seed. */
  hops: number;
};

export type GraphFetchers = {
  byKey: (args: { source?: string; key: string }) => Promise<DocumentByKeyResult>;
  listMatching: (args: {
    source?: string;
    filter_field: "parent";
    filter_value: string;
  }) => Promise<DocumentListResult>;
};

export type LinkedWorkItemsArgs = {
  source?: string;
  key: string;
  relation?: LinkedRelation;
  link_kind?: string;
  depth?: number;
};

export type DependencyClosureArgs = {
  source?: string;
  keys: string[];
  direction?: ClosureDirection;
  depth?: number;
};

export type GraphResult = {
  seeds: string[];
  source: string;
  edges: StoredEdge[];
  related_keys: string[];
  truncated: boolean;
  visited_count: number;
  note: string;
};

const GRAPH_RESULT_NOTE =
  "Stored indexed edges only (parent, issuelink/issuelink_type). " +
  "Absence of an edge means not recorded, not doesn't-exist. " +
  "LINKS_TO is undirected: stored tags carry no direction. " +
  "Never state a relationship this edge list does not contain.";

const defaultFetchers: GraphFetchers = {
  byKey: (args) => getDocumentByKey(args),
  listMatching: (args) => listDocumentsMatching(args),
};

/** Case-insensitive key identity. Display keeps the verbatim stored form. */
export function normalizeGraphKey(key: string): string {
  return key.trim().toUpperCase();
}

/**
 * Split one stored tag value into individual entries, preserving order and
 * repeats. No dedup here: `issuelink`/`issuelink_type` arrive as parallel
 * arrays and positional pairing breaks if repeats are collapsed.
 * Splits only on list delimiters (comma/semicolon/newline/pipe) — never on
 * spaces or prose, so a stored value is never re-interpreted.
 */
export function splitStoredValues(value: unknown): string[] {
  const raws = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const raw of raws) {
    if (typeof raw !== "string") continue;
    for (const part of raw.split(/[,;\n|]+/)) {
      const trimmed = part.trim();
      if (trimmed) out.push(trimmed);
    }
    if (out.length >= 20) break;
  }
  return out.slice(0, 20);
}

/**
 * Split an embedded "<kind>:<KEY>" stored link into its parts.
 * Some indexes pack the kind with the target (e.g. "blocks:BN-217").
 * Returns null unless the suffix is key-shaped — anything else stays verbatim
 * so an odd stored value is never re-interpreted into a traversal.
 */
export function parseEmbeddedLink(value: string): { kind: string; key: string } | null {
  const match = /^([^:,{}\[\]]+?)\s*:\s*([A-Za-z][A-Za-z0-9]*-\d+)$/.exec(value.trim());
  if (!match?.[1] || !match?.[2]) return null;
  const kind = match[1].trim();
  if (!kind) return null;
  return { kind, key: match[2] };
}

/**
 * Project stored tag fields onto edges. Only `parent` and `issuelink` produce
 * edges — description/body mentions never do. An embedded "<kind>:<KEY>" link
 * is split so traversal can follow the key; the kind rides along verbatim.
 */
export function edgesFromStoredFields(
  key: string,
  fields: Record<string, string | string[]> | undefined,
  hops: number
): StoredEdge[] {
  if (!fields) return [];
  const edges: StoredEdge[] = [];
  for (const parent of splitStoredValues(fields.parent)) {
    if (normalizeGraphKey(parent) === normalizeGraphKey(key)) continue;
    edges.push({ from_key: key, to_key: parent, relation: "CHILD_OF", link_kind: null, hops });
  }
  const links = splitStoredValues(fields.issuelink);
  const kinds = splitStoredValues(fields.issuelink_type);
  links.forEach((target, index) => {
    const embedded = parseEmbeddedLink(target);
    const to = embedded?.key ?? target;
    if (normalizeGraphKey(to) === normalizeGraphKey(key)) return;
    // The kind attached to this specific link wins; otherwise fall back to
    // parallel-array pairing, a single stored kind, or unknown (never guessed).
    const kind =
      embedded?.kind ??
      (kinds.length === links.length ? kinds[index] : kinds.length === 1 ? kinds[0] : null);
    edges.push({ from_key: key, to_key: to, relation: "LINKS_TO", link_kind: kind ?? null, hops });
  });
  return edges;
}

function pushEdgeUnique(into: StoredEdge[], edge: StoredEdge): void {
  const dupe = into.some(
    (row) =>
      normalizeGraphKey(row.from_key) === normalizeGraphKey(edge.from_key) &&
      normalizeGraphKey(row.to_key) === normalizeGraphKey(edge.to_key) &&
      row.relation === edge.relation &&
      (row.link_kind ?? "") === (edge.link_kind ?? "")
  );
  if (!dupe) into.push(edge);
}

function sourceParam(source?: string): string | undefined {
  return source && source !== ASK_SOURCE_ALL ? source : undefined;
}

function clampDepth(depth?: number, fallback = 1): number {
  if (!Number.isInteger(depth)) return fallback;
  return Math.min(GRAPH_MAX_DEPTH, Math.max(1, depth as number));
}

function kindMatches(edge: StoredEdge, linkKind?: string): boolean {
  if (!linkKind) return true;
  return (edge.link_kind ?? "").toLowerCase() === linkKind.trim().toLowerCase();
}

type FrontierNode = { key: string; depth: number };

async function expandChildren(
  source: string | undefined,
  key: string,
  hops: number,
  edges: StoredEdge[],
  fetchers: GraphFetchers,
  state: { truncated: boolean }
): Promise<string[]> {
  let list: DocumentListResult;
  try {
    list = await fetchers.listMatching({
      ...(sourceParam(source) ? { source: sourceParam(source) as string } : {}),
      filter_field: "parent",
      filter_value: key,
    });
  } catch (err) {
    // Config failures (missing PAT) must surface as tool_failed, never as an
    // empty result the model could read as "no children."
    if (err instanceof StafflessConfigError) throw err;
    state.truncated = true;
    return [];
  }
  if (list.truncated) state.truncated = true;
  const children: string[] = [];
  for (const row of list.documents) {
    if (!row.key) continue;
    pushEdgeUnique(edges, {
      from_key: row.key,
      to_key: key,
      relation: "CHILD_OF",
      link_kind: null,
      hops,
    });
    children.push(row.key);
  }
  return children;
}

async function expandStoredLinks(
  source: string | undefined,
  key: string,
  hops: number,
  edges: StoredEdge[],
  fetchers: GraphFetchers,
  state: { truncated: boolean }
): Promise<{ parent: string | null; linked: string[]; found: boolean }> {
  let doc: DocumentByKeyResult;
  try {
    doc = await fetchers.byKey({
      ...(sourceParam(source) ? { source: sourceParam(source) as string } : {}),
      key,
    });
  } catch (err) {
    // Same fail-closed rule as expandChildren: a config failure is a lookup
    // failure, never "not in the index."
    if (err instanceof StafflessConfigError) throw err;
    state.truncated = true;
    return { parent: null, linked: [], found: false };
  }
  if (!doc.found) return { parent: null, linked: [], found: false };
  const fresh = edgesFromStoredFields(key, doc.fields, hops);
  let parent: string | null = null;
  const linked: string[] = [];
  for (const edge of fresh) {
    pushEdgeUnique(edges, edge);
    if (edge.relation === "CHILD_OF" && !parent) parent = edge.to_key;
    if (edge.relation === "LINKS_TO") linked.push(edge.to_key);
  }
  return { parent, linked, found: true };
}

function toGraphResult(
  seeds: string[],
  source: string | undefined,
  edges: StoredEdge[],
  visited: Map<string, number>,
  truncated: boolean
): GraphResult {
  const seedSet = new Set(seeds.map(normalizeGraphKey));
  const related = [...visited.keys()].filter((key) => !seedSet.has(key));
  return {
    seeds,
    source: source ?? ASK_SOURCE_ALL,
    edges,
    related_keys: related,
    truncated,
    visited_count: visited.size,
    note: GRAPH_RESULT_NOTE,
  };
}

/**
 * Traverse stored edges from one seed key.
 * @param args - Seed key, relation scope, optional stored link_kind, depth cap.
 * @param fetchers - Catalog-backed reads (injectable for tests).
 */
export async function getLinkedWorkItems(
  args: LinkedWorkItemsArgs,
  fetchers: GraphFetchers = defaultFetchers
): Promise<GraphResult> {
  const seed = args.key.trim();
  const relation: LinkedRelation = args.relation ?? "linked";
  const depth = clampDepth(args.depth, 1);
  const edges: StoredEdge[] = [];
  const visited = new Map<string, number>([[normalizeGraphKey(seed), 0]]);
  const expanded = new Set<string>();
  const state = { truncated: false };
  let frontier: FrontierNode[] = [{ key: seed, depth: 0 }];
  let seedFound = relation === "children";

  for (let round = 0; round < depth; round += 1) {
    const next: FrontierNode[] = [];
    for (const node of frontier) {
      if (node.depth !== round) continue;
      const targets =
        relation === "children"
          ? await expandChildren(args.source, node.key, round + 1, edges, fetchers, state)
          : await expandLinkedTargets(args.source, node.key, relation, round + 1, edges, fetchers, state, expanded);
      if (round === 0 && node.key === seed) seedFound = seedFound || targets !== null;
      for (const target of targets ?? []) {
        const norm = normalizeGraphKey(target);
        if (visited.has(norm) || visited.size >= GRAPH_MAX_VISITED) {
          if (!visited.has(norm)) state.truncated = true;
          continue;
        }
        visited.set(norm, round + 1);
        next.push({ key: target, depth: round + 1 });
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  if (!seedFound) {
    return {
      seeds: [seed],
      source: args.source ?? ASK_SOURCE_ALL,
      edges: [],
      related_keys: [],
      truncated: false,
      visited_count: 0,
      note: "No indexed document with this exact key. " + GRAPH_RESULT_NOTE,
    };
  }

  const scoped = edges.filter(
    (edge) =>
      (relation === "parent_chain" ? edge.relation === "CHILD_OF" : true) &&
      kindMatches(edge, args.link_kind)
  );
  // Related keys come from the filtered edge set — not the visited set — so a
  // link_kind filter (e.g. only Blocks) never leaks an excluded neighbor into
  // the answer list.
  const seedNorm = normalizeGraphKey(seed);
  const related: string[] = [];
  for (const edge of scoped) {
    for (const end of [edge.from_key, edge.to_key]) {
      if (normalizeGraphKey(end) !== seedNorm && !related.some((k) => normalizeGraphKey(k) === normalizeGraphKey(end))) {
        related.push(end);
      }
    }
  }
  return {
    seeds: [seed],
    source: args.source ?? ASK_SOURCE_ALL,
    edges: scoped,
    related_keys: related,
    truncated: state.truncated || visited.size >= GRAPH_MAX_VISITED,
    visited_count: visited.size,
    note: GRAPH_RESULT_NOTE,
  };
}

async function expandLinkedTargets(
  source: string | undefined,
  key: string,
  relation: LinkedRelation,
  hops: number,
  edges: StoredEdge[],
  fetchers: GraphFetchers,
  state: { truncated: boolean },
  expanded: Set<string>
): Promise<string[] | null> {
  // One catalog read per key per turn — deeper rounds reuse recorded edges.
  if (expanded.has(normalizeGraphKey(key))) {
    return [];
  }
  expanded.add(normalizeGraphKey(key));
  const row = await expandStoredLinks(source, key, hops, edges, fetchers, state);
  if (!row.found) return null;
  if (relation === "parent_chain") return row.parent ? [row.parent] : [];
  return row.linked;
}

/**
 * Traverse stored edges from up to 10 seed keys.
 * @param args - Seed keys, upstream/downstream direction, depth cap.
 * @param fetchers - Catalog-backed reads (injectable for tests).
 */
export async function getDependencyClosure(
  args: DependencyClosureArgs,
  fetchers: GraphFetchers = defaultFetchers
): Promise<GraphResult> {
  const seeds = args.keys.map((key) => key.trim()).filter(Boolean).slice(0, GRAPH_MAX_SEEDS);
  const depth = clampDepth(args.depth, 2);
  const direction: ClosureDirection = args.direction ?? "upstream";
  const edges: StoredEdge[] = [];
  const visited = new Map<string, number>();
  const state = { truncated: false };
  let frontier: FrontierNode[] = [];

  for (const seed of seeds) {
    const norm = normalizeGraphKey(seed);
    if (visited.has(norm)) continue;
    visited.set(norm, 0);
    frontier.push({ key: seed, depth: 0 });
  }

  for (let round = 0; round < depth; round += 1) {
    const next: FrontierNode[] = [];
    for (const node of frontier) {
      if (node.depth !== round) continue;
      const targets = await expandClosureTargets(
        args.source,
        node.key,
        direction,
        round + 1,
        edges,
        fetchers,
        state
      );
      for (const target of targets) {
        const norm = normalizeGraphKey(target);
        if (visited.has(norm) || visited.size >= GRAPH_MAX_VISITED) {
          if (!visited.has(norm)) state.truncated = true;
          continue;
        }
        visited.set(norm, round + 1);
        next.push({ key: target, depth: round + 1 });
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  return {
    ...toGraphResult(seeds, args.source, edges, visited, state.truncated || visited.size >= GRAPH_MAX_VISITED),
  };
}

async function expandClosureTargets(
  source: string | undefined,
  key: string,
  direction: ClosureDirection,
  hops: number,
  edges: StoredEdge[],
  fetchers: GraphFetchers,
  state: { truncated: boolean }
): Promise<string[]> {
  const row = await expandStoredLinks(source, key, hops, edges, fetchers, state);
  // The parent CHILD_OF edge is recorded for context in both directions;
  // only upstream traverses it — downstream lists children instead.
  const out = [...row.linked];
  if (direction === "upstream" && row.parent) out.push(row.parent);
  if (direction === "downstream") {
    out.push(...(await expandChildren(source, key, hops, edges, fetchers, state)));
  }
  return out;
}
