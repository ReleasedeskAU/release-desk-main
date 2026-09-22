"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { s3ScopeDisplay } from "@/lib/s3/scopes";

interface ScopePreview {
  prefix: string;
  approxFiles: number;
  approxBytes: number;
  truncated: boolean;
  topTypes: { ext: string; count: number }[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Confirm-step summary for S3 onboarding: the chosen scopes plus an
 * approximate preview (file count, size, top file types) for each. Every
 * number is a sample — the UI labels them approximate, never exact.
 */
export function S3ScopeSummary({
  accessKeyId,
  secretAccessKey,
  bucket,
  connectorId,
  scopes,
  isEdit,
  scopeChanged,
}: {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  connectorId?: string | null;
  scopes: string[];
  isEdit: boolean;
  scopeChanged?: boolean;
}) {
  const [previews, setPreviews] = useState<ScopePreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = scopes.join("\n");
  const canPreview = Boolean((connectorId || (accessKeyId && secretAccessKey && bucket)) && scopes.length > 0);

  useEffect(() => {
    let cancelled = false;
    setPreviews(null);
    setError(null);
    if (!canPreview) return;
    (async () => {
      try {
        const res = await fetch("/api/connectors/s3/browse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
          connectorId
            ? { connectorId, preview: true, prefixes: scopes }
            : { accessKeyId, secretAccessKey, bucket, preview: true, prefixes: scopes }
        ),
        });
        const body = (await res.json().catch(() => ({}))) as { previews?: ScopePreview[]; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setError(body.error ?? "Could not preview these folders");
          return;
        }
        setPreviews(body.previews ?? []);
      } catch {
        if (!cancelled) setError("Could not preview these folders");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-preview only when the scope set changes (key), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, canPreview]);

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
      <h3 className="text-sm font-semibold text-gray-800">Indexing scope</h3>
      {scopes.length > 1 ? (
        <p className="text-xs text-gray-600">
          These folders are stored on one connector — one credential, one sync, one pause.
        </p>
      ) : null}
      {isEdit && scopeChanged ? (
        <p className="text-xs font-semibold text-amber-900">
          Saving this scope change removes previously indexed items that are no longer in scope and re-indexes from the start.
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {!error && canPreview && previews == null ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Sampling each folder for an approximate preview…
        </p>
      ) : null}
      <ul className="space-y-2">
        {scopes.map((scope) => {
          const preview = previews?.find((p) => p.prefix === scope);
          return (
            <li key={scope} className="rounded-lg bg-white px-3 py-2 ring-1 ring-gray-200">
              <p className="font-mono text-sm font-semibold text-gray-900">{s3ScopeDisplay(scope)}</p>
              {!preview ? (
                <p className="text-xs text-gray-400">Preview unavailable — the connector still indexes this scope.</p>
              ) : (
                <p className="text-xs text-gray-600">
                  ≈ {preview.approxFiles.toLocaleString()} files{preview.truncated ? "+" : ""} · ≈{" "}
                  {formatBytes(preview.approxBytes)}
                  {preview.topTypes.length > 0 ? (
                    <> · {preview.topTypes.map((t) => `${t.ext} ×${t.count}`).join(", ")}</>
                  ) : null}
                  <span className="text-gray-400"> (approximate sample)</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
