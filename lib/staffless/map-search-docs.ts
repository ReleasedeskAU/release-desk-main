import { classifyStatusCategory } from "@/lib/jira-status-category";

export type StafflessSearchDoc = {
  document_id?: string;
  semantic_identifier?: string;
  source_type?: string;
  metadata?: Record<string, unknown> | null;
  updated_at?: string | null;
  link?: string | null;
};

export type WorkItemRow = {
  id: string;
  externalId: string;
  title: string;
  itemType: string;
  releaseCode: string | null;
  status: string;
  statusCategory: string | null;
  assignee: string | null;
  priority: string | null;
  blockedBy: string | null;
  source: string;
  connectorId: string | null;
  createdAt: string;
  updatedAt: string;
};

function metaString(
  metadata: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | null {
  if (!metadata) return null;
  for (const key of keys) {
    const value = metadata[key];
    const text = stringifyMeta(value);
    if (text) return text;
  }
  return null;
}

function stringifyMeta(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.length > 0) return stringifyMeta(value[0]);
  return null;
}

function splitSemantic(semantic: string): { key: string | null; title: string } {
  const trimmed = semantic.trim();
  const colon = trimmed.indexOf(": ");
  if (colon > 0 && colon < 40) {
    return { key: trimmed.slice(0, colon).trim(), title: trimmed.slice(colon + 2).trim() };
  }
  return { key: null, title: trimmed };
}

function sourceLabel(sourceType: string | undefined): string {
  if (!sourceType) return "StaffLess AI";
  const lower = sourceType.toLowerCase();
  if (lower === "jira") return "Jira";
  if (lower === "github") return "GitHub";
  if (lower === "bitbucket") return "Bitbucket";
  if (lower === "teams") return "Microsoft Teams";
  if (lower === "imap") return "Email (IMAP)";
  return sourceType.replace(/_/g, " ");
}

/**
 * Convert one StaffLess search hit into a work-item row.
 * Missing Jira-shaped fields become null or a conservative fallback — never invented releases.
 */
export function mapSearchDocToWorkItem(
  doc: StafflessSearchDoc,
  connectorId: string | null = null
): WorkItemRow {
  const metadata = doc.metadata ?? {};
  const semantic = typeof doc.semantic_identifier === "string" ? doc.semantic_identifier : "";
  const parts = splitSemantic(semantic);
  const externalId =
    metaString(metadata, "key", "id") ||
    parts.key ||
    (typeof doc.document_id === "string" ? doc.document_id.split("/").pop() || doc.document_id : "unknown");
  const updatedAt =
    metaString(metadata, "updated", "updated_at") ||
    doc.updated_at ||
    new Date(0).toISOString();

  return {
    id: typeof doc.document_id === "string" && doc.document_id ? doc.document_id : externalId,
    externalId,
    title: parts.title || semantic || externalId,
    itemType: metaString(metadata, "issuetype", "object_type") || "Document",
    releaseCode: metaString(metadata, "release", "fixVersion", "fix_version", "version"),
    status: metaString(metadata, "status", "state") || "Indexed",
    statusCategory: classifyStatusCategory(metaString(metadata, "status_category")),
    assignee: metaString(metadata, "assignee", "user"),
    priority: metaString(metadata, "priority"),
    blockedBy: metaString(metadata, "parent"),
    source: sourceLabel(doc.source_type),
    connectorId,
    createdAt: metaString(metadata, "created", "created_at") || updatedAt,
    updatedAt,
  };
}

export function mapSearchDocsToWorkItems(
  docs: StafflessSearchDoc[],
  connectorId: string | null = null
): WorkItemRow[] {
  const seen = new Set<string>();
  const rows: WorkItemRow[] = [];
  for (const doc of docs) {
    const row = mapSearchDocToWorkItem(doc, connectorId);
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  return rows;
}
