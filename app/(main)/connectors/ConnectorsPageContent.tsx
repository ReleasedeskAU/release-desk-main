"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, History, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { getConnectorTypeDef, statusBadge } from "@/lib/connectors/types";
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { CONNECTOR_DELETING_POLL_MS, type ConnectorTableRow } from "@/lib/staffless/map-indexing-status";
import { isStafflessConnectorType } from "@/lib/staffless/create-payload";
import { SyncedWorkItemsSection } from "@/components/connectors/SyncedWorkItemsSection";
import { ConnectorWizard } from "./ConnectorWizard";
import { ConnectorTypeIcon } from "./ConnectorTypeIcon";
import { SyncLogsDrawer } from "./SyncLogsDrawer";

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function typeLabel(type: string): string {
  return getConnectorTypeDef(type)?.label ?? type;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return body.error ?? body.message ?? `Request failed (${res.status})`;
}

export default function ConnectorsPageContent() {
  const [connectors, setConnectors] = useState<ConnectorTableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editConnector, setEditConnector] = useState<ConnectorTableRow | null>(null);
  const [historyConnector, setHistoryConnector] = useState<ConnectorTableRow | null>(null);
  const [errorDetail, setErrorDetail] = useState<{ name: string; message: string } | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [workItemsRefreshKey, setWorkItemsRefreshKey] = useState(0);

  const applyConnectorUpdate = useCallback((row: ConnectorTableRow) => {
    setConnectors((prev) => prev.map((item) => (item.id === row.id ? row : item)));
    setHistoryConnector((prev) => (prev && prev.id === row.id ? row : prev));
  }, []);

  const loadConnectors = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) {
      setLoading(true);
      setError(null);
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch("/api/connectors", { signal: controller.signal });
      if (!res.ok) throw new Error(await readError(res));
      setConnectors(await res.json());
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setError("Request timed out. Check that StaffLess AI is reachable and try refreshing.");
      } else {
        setError(e instanceof Error ? e.message : "Failed to load connectors");
      }
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  useEffect(() => {
    if (!connectors.some((row) => row.status === "DELETING")) return;
    const timer = window.setInterval(() => {
      void loadConnectors({ quiet: true });
    }, CONNECTOR_DELETING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [connectors, loadConnectors]);

  const runAction = async (id: string, work: () => Promise<void>) => {
    setActionId(id);
    setError(null);
    setNotice(null);
    try {
      await work();
      await loadConnectors({ quiet: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionId(null);
    }
  };

  const syncNow = (id: string, fromBeginning = false) =>
    runAction(id, async () => {
      const res = await fetch(`/api/connectors/${id}/sync-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromBeginning }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setWorkItemsRefreshKey((k) => k + 1);
    });

  const togglePaused = (connector: ConnectorTableRow) =>
    runAction(connector.id, async () => {
      const res = await fetch(`/api/connectors/${connector.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !connector.enabled }),
      });
      if (!res.ok) throw new Error(await readError(res));
    });

  const deleteConnector = (connector: ConnectorTableRow) => {
    const retrying = connector.status === "DELETING";
    const ok = confirm(
      retrying
        ? `"${connector.name}" is already marked for deletion. Queue StaffLess again to retry removing the indexed copy? Jira/GitHub/Teams/email themselves are unchanged.`
        : `Delete "${connector.name}"? StaffLess will remove the indexed copy of this data. Nothing is deleted in ${typeLabel(connector.type)} itself. This cannot be undone.`
    );
    if (!ok) return;
    void runAction(connector.id, async () => {
      const res = await fetch(`/api/connectors/${connector.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res));
      setNotice(
        "Deletion scheduled. This row leaves the list when StaffLess finishes removing indexed copies. The source system is unchanged."
      );
    });
  };

  return (
    <div className="w-full font-sans pb-24 relative">
      <div className="mb-8 mt-2">
        <div className="flex items-center text-[13px] text-gray-500 font-medium mb-3">
          <span className="hover:text-gray-800 cursor-pointer">Settings</span>
          <ChevronRight className="h-3 w-3 mx-1.5" />
          <span className="text-[#2548C9] font-semibold">Connectors</span>
        </div>
        <div className="flex items-start justify-between">
          <div className="max-w-[700px]">
            <h1 className="text-[32px] font-bold text-[#111827] tracking-tight mb-2">System Connectors</h1>
            <p className="text-[15px] text-gray-500 font-medium leading-relaxed">
              Poll Jira, GitHub, Teams, and email (IMAP). Sync Now queues an index run; Pause stops polling; Delete
              removes the indexed copy of that data. To add other sources, use{" "}
              <Link href="/admin-connectors" className="text-[#2548C9] hover:underline">
                Admin Connectors
              </Link>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditConnector(null);
              setWizardOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-[#2548C9] px-6 py-2.5 text-[14px] font-semibold text-white shadow-sm hover:bg-[#1E3A9F] transition-colors"
          >
            <Plus className="h-4 w-4" /> Add Connector
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{notice}</div>
      )}

      {loading ? (
        <TableSkeleton showTitle={false} columns={6} rows={5} showFilterBar={false} />
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-[12px] uppercase tracking-wide text-gray-500 font-semibold">
              <tr>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Docs</th>
                <th className="px-5 py-3">Last Synced</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {connectors.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-gray-500">
                    No connectors yet. Click &quot;Add Connector&quot; to get started.
                  </td>
                </tr>
              ) : (
                connectors.map((c) => {
                  const badge = statusBadge(c.status, c.enabled);
                  const busy = actionId === c.id;
                  const deleting = c.status === "DELETING";
                  return (
                    <tr key={c.ccPairId ?? c.id} className="hover:bg-gray-50/50 transition-all duration-200">
                      <td className="border-b border-gray-200 px-5 py-4 font-semibold text-gray-900">{c.name}</td>
                      <td className="border-b border-gray-200 px-5 py-4">
                        <div className="flex items-center gap-2">
                          <ConnectorTypeIcon type={c.type} />
                          <span>{typeLabel(c.type)}</span>
                        </div>
                      </td>
                      <td className="border-b border-gray-200 px-5 py-4">
                        <button
                          type="button"
                          disabled={!c.lastError}
                          onClick={() => c.lastError && setErrorDetail({ name: c.name, message: c.lastError })}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.color} ${c.lastError ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
                        >
                          <span>{badge.emoji}</span> {badge.label}
                        </button>
                      </td>
                      <td className="border-b border-gray-200 px-5 py-4 text-gray-600">{c.docsIndexed}</td>
                      <td className="border-b border-gray-200 px-5 py-4 text-gray-600">{relativeTime(c.lastSyncedAt)}</td>
                      <td className="border-b border-gray-200 px-5 py-4">
                        <div className="flex flex-wrap items-center justify-end gap-2 min-w-[220px]">
                          <button
                            type="button"
                            disabled={busy || !c.enabled || deleting}
                            onClick={() => syncNow(c.id)}
                            className="text-[#2548C9] hover:underline text-xs font-semibold disabled:opacity-40"
                          >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sync Now"}
                          </button>
                          <button
                            type="button"
                            disabled={busy || deleting}
                            onClick={() => setHistoryConnector(c)}
                            className="text-gray-600 hover:text-gray-900 disabled:opacity-40"
                            title="Sync logs"
                            aria-label="Open sync logs"
                          >
                            <History className="h-4 w-4" />
                          </button>
                          {isStafflessConnectorType(c.type) && (
                            <button
                              type="button"
                              disabled={busy || deleting}
                              onClick={() => {
                                setEditConnector(c);
                                setWizardOpen(true);
                              }}
                              className="text-gray-600 hover:text-gray-900 disabled:opacity-40"
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy || deleting}
                            onClick={() => togglePaused(c)}
                            className="text-gray-600 hover:text-gray-900 text-xs font-semibold disabled:opacity-40"
                          >
                            {c.enabled ? "Pause" : "Resume"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => deleteConnector(c)}
                            className="text-red-600 hover:text-red-800 disabled:opacity-40"
                            title={deleting ? "Retry delete" : "Delete"}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <SyncedWorkItemsSection refreshKey={workItemsRefreshKey} />

      {wizardOpen && (
        <ConnectorWizard
          mode={editConnector ? "edit" : "create"}
          existingConnector={editConnector}
          onClose={() => {
            setWizardOpen(false);
            setEditConnector(null);
          }}
          onSaved={() => {
            setWizardOpen(false);
            setEditConnector(null);
            void loadConnectors();
          }}
        />
      )}

      {historyConnector && (
        <SyncLogsDrawer
          connector={historyConnector}
          onClose={() => setHistoryConnector(null)}
          onUpdated={applyConnectorUpdate}
          onSyncFromBeginning={() => {
            setHistoryConnector(null);
            void syncNow(historyConnector.id, true);
          }}
          onPrune={async () => {
            const res = await fetch(`/api/connectors/${historyConnector.id}/prune`, { method: "POST" });
            if (!res.ok) throw new Error(await readError(res));
            await loadConnectors();
          }}
        />
      )}

      {errorDetail && (
        <ErrorModal name={errorDetail.name} message={errorDetail.message} onClose={() => setErrorDetail(null)} />
      )}
    </div>
  );
}

function ErrorModal({ name, message, onClose }: { name: string; message: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2 text-red-700">
            <AlertTriangle className="h-5 w-5" />
            <h3 className="font-bold text-lg">{name} — Index error</h3>
          </div>
          <button type="button" onClick={onClose}>
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>
        <p className="text-sm text-gray-700">{message}</p>
      </div>
    </div>
  );
}

