"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { safeFetchJson } from "@/lib/safe-fetch";
import type { WorkItemSummary } from "@/lib/dependency-impact";

type WorkItemRow = {
  id: string;
  externalId: string;
  title: string;
  itemType: string;
  releaseCode: string | null;
  status: string;
  assignee: string | null;
  author?: string | null;
  priority: string | null;
  blockedBy: string | null;
  source: string;
  connectorId: string | null;
  createdAt: string;
  updatedAt: string;
  statusCategory?: string | null;
};

type ConnectorOption = {
  id: string;
  name: string;
  type: string;
  lastSyncedAt: string | null;
};

type WorkItemsPayload = {
  items: WorkItemRow[];
  total: number;
  limit: number;
  offset: number;
  summary: WorkItemSummary;
  lastSynced: string | null;
  connectors: ConnectorOption[];
};

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("done") || s.includes("closed") || s.includes("resolved")) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (s.includes("block") || s.includes("fail")) {
    return "bg-rose-50 text-rose-700 border-rose-200";
  }
  if (s.includes("progress") || s.includes("review")) {
    return "bg-sky-50 text-sky-700 border-sky-200";
  }
  return "bg-gray-50 text-gray-700 border-gray-200";
}

/**
 * Indexed documents from StaffLess AI, shown in the existing work-item table.
 * @param refreshKey - Increment after Sync Now so the table reloads.
 */
export function SyncedWorkItemsSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const [payload, setPayload] = useState<WorkItemsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectorId, setConnectorId] = useState<string>("");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: "500", offset: "0" });
    if (connectorId) params.set("connectorId", connectorId);
    if (qDebounced) params.set("q", qDebounced);

    const result = await safeFetchJson<WorkItemsPayload | { error?: string }>(
      `/api/work-items?${params.toString()}`,
      { label: "list-work-items", rejectHttpErrors: false }
    );
    setLoading(false);

    if (!result.ok || result.status >= 300) {
      const body = result.ok ? (result.data as { error?: string }) : null;
      setError(body?.error ?? `Could not load work items (${result.ok ? result.status : "network"})`);
      setPayload(null);
      return;
    }
    setPayload(result.data as WorkItemsPayload);
  }, [connectorId, qDebounced]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Near-real-time demo UX: poll while this section is mounted (webhook writes land in seconds).
  useEffect(() => {
    const id = window.setInterval(() => {
      void load();
    }, 5_000);
    return () => window.clearInterval(id);
  }, [load]);

  const jiraConnectors = useMemo(
    () => (payload?.connectors ?? []).filter((c) => c.type === "jira"),
    [payload?.connectors]
  );

  const typeBreakdown = useMemo(() => {
    const entries = Object.entries(payload?.summary.byType ?? {}).sort((a, b) => b[1] - a[1]);
    return entries.slice(0, 6);
  }, [payload?.summary.byType]);

  return (
    <section className="mt-10">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#111827] tracking-tight">Synced Work Items</h2>
          <p className="mt-1 text-[14px] text-gray-500 font-medium leading-relaxed max-w-[720px]">
            Indexed documents from StaffLess AI after sync (Jira, GitHub, Teams, and IMAP email when
            connected). This table refreshes after Sync Now.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-[14px] font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      {error ? (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search key, title, assignee, author…"
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-[#2548C9] focus:ring-1 focus:ring-[#2548C9]"
          />
        </div>
        <select
          value={connectorId}
          onChange={(e) => setConnectorId(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 outline-none focus:border-[#2548C9]"
        >
          <option value="">All connectors</option>
          {(payload?.connectors ?? jiraConnectors).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.type})
            </option>
          ))}
        </select>
        {payload ? (
          <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold">
            <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-gray-700">
              {payload.total} total
            </span>
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-800">
              {payload.summary.open} open
            </span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800">
              {payload.summary.done} done
            </span>
            {payload.summary.unclassified > 0 ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-900">
                {payload.summary.unclassified} unclassified
              </span>
            ) : null}
            {payload.summary.blocked > 0 ? (
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-rose-800">
                {payload.summary.blocked} blocked
              </span>
            ) : null}
            <span className="text-gray-500 font-medium">
              Last sync: {relativeTime(payload.lastSynced)}
            </span>
          </div>
        ) : null}
      </div>

      {typeBreakdown.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2 text-[12px] text-gray-600">
          {typeBreakdown.map(([type, count]) => (
            <span key={type} className="rounded-md bg-gray-100 px-2 py-1 font-medium">
              {type}: {count}
            </span>
          ))}
        </div>
      ) : null}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {loading && !payload ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading work items…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-[12px] uppercase tracking-wide text-gray-500 font-semibold">
                <tr>
                  <th className="px-4 py-3">Key</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Assignee</th>
                  <th className="px-4 py-3">Author</th>
                  <th className="px-4 py-3">Release</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {!payload || payload.items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-5 py-10 text-center text-gray-500">
                      No indexed documents yet. Run <span className="font-semibold">Sync Now</span> on a
                      StaffLess AI connector, then refresh this table.
                    </td>
                  </tr>
                ) : (
                  payload.items.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="border-b border-gray-200 px-4 py-3 font-semibold text-[#2548C9] whitespace-nowrap">
                        {item.externalId}
                      </td>
                      <td className="border-b border-gray-200 px-4 py-3 text-gray-900 max-w-[280px]">
                        <span className="line-clamp-2" title={item.title}>
                          {item.title}
                        </span>
                        {item.blockedBy ? (
                          <span className="mt-0.5 block text-[11px] text-rose-600">
                            Blocked by {item.blockedBy}
                          </span>
                        ) : null}
                      </td>
                      <td className="border-b border-gray-200 px-4 py-3 text-gray-700 whitespace-nowrap">
                        {item.itemType}
                      </td>
                      <td className="border-b border-gray-200 px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone(item.status)}`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="border-b border-gray-200 px-4 py-3 text-gray-700 whitespace-nowrap">
                        {item.priority ?? "—"}
                      </td>
                      <td className="border-b border-gray-200 px-4 py-3 text-gray-700 whitespace-nowrap">
                        {item.assignee ?? "—"}
                      </td>
                      <td className="border-b border-gray-200 px-4 py-3 text-gray-700 whitespace-nowrap">
                        {item.author ?? "—"}
                      </td>
                      <td className="border-b border-gray-200 px-4 py-3 text-gray-700 whitespace-nowrap">
                        {item.releaseCode ?? "—"}
                      </td>
                      <td className="border-b border-gray-200 px-4 py-3 text-gray-700 whitespace-nowrap">
                        {item.source}
                      </td>
                      <td className="border-b border-gray-200 px-4 py-3 text-gray-500 whitespace-nowrap">
                        {relativeTime(item.updatedAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {payload && payload.total > payload.items.length ? (
        <p className="mt-2 text-[12px] text-gray-500">
          Showing {payload.items.length} of {payload.total}. Narrow with search or connector filter.
        </p>
      ) : null}
    </section>
  );
}
