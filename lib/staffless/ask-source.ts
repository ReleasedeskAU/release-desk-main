/**
 * Ask `source` ids come from created connectors, not a hardcoded vendor list.
 * `all` means no source filter. Language mapping stays in the model.
 */

import { getAdminConnectorSource } from "@/lib/admin-connectors/catalog";

const SOURCE_SLUG = /^[a-z][a-z0-9_]{0,39}$/;
const HIDDEN_ASK_SOURCES = new Set(["ingestion_api"]);

export const ASK_SOURCE_ALL = "all";

export type AskIndexedSource = {
  id: string;
  label: string;
  docsIndexed: number;
};

export type AskSourceContext = {
  sources: AskIndexedSource[];
};

/**
 * Normalize a tool `source` argument. Returns null when the value is not a slug.
 */
export function askSourceSlug(value: string): string | null {
  const slug = value.trim().toLowerCase();
  if (slug === ASK_SOURCE_ALL) return ASK_SOURCE_ALL;
  if (!SOURCE_SLUG.test(slug) || HIDDEN_ASK_SOURCES.has(slug)) return null;
  return slug;
}

/**
 * Display label for a source id. Uses the Admin Connectors catalog when present.
 */
export function askSourceLabel(id: string): string {
  return getAdminConnectorSource(id)?.label ?? id.replace(/_/g, " ");
}

/**
 * Deduplicate created connectors by engine source id.
 * A source with 0 documents stays listed so Ask can say it is connected but empty.
 */
export function uniqueAskSources(
  rows: ReadonlyArray<{ type: string; docsIndexed: number }>
): AskIndexedSource[] {
  const byId = new Map<string, AskIndexedSource>();
  for (const row of rows) {
    const id = askSourceSlug(row.type);
    if (!id || id === ASK_SOURCE_ALL) continue;
    const docs = Number.isFinite(row.docsIndexed) ? Math.max(0, Math.floor(row.docsIndexed)) : 0;
    const prev = byId.get(id);
    byId.set(id, {
      id,
      label: askSourceLabel(id),
      docsIndexed: (prev?.docsIndexed ?? 0) + docs,
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * True when this turn's connector list may use the source (or no list was loaded).
 */
export function isAllowedAskSource(source: string, context?: AskSourceContext): boolean {
  const slug = askSourceSlug(source);
  if (!slug) return false;
  if (slug === ASK_SOURCE_ALL) return true;
  if (!context || context.sources.length === 0) return true;
  return context.sources.some((item) => item.id === slug);
}

/**
 * System-prompt inventory for this Ask turn. No secrets.
 */
export function formatAskSourceInventory(sources: AskIndexedSource[]): string {
  if (sources.length === 0) {
    return "Indexed connector sources this turn: none listed. Use list_indexed_sources. Do not assume Jira, GitHub, or any other vendor.";
  }
  const lines = sources.map((item) => `- ${item.id} (${item.label}): ${item.docsIndexed} searchable documents`);
  return [
    "Indexed connector sources this turn (created connectors; 0 documents means connected but not yet searchable):",
    ...lines,
    "Use source=<id> on tools. source=all means every listed source. A missing id is not created. Never claim a fixed vendor list.",
  ].join("\n");
}
