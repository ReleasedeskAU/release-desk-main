"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Folder, Home, Loader2, Lock, RefreshCw } from "lucide-react";
import { normalizeScopeInput, normalizePatternInput, s3ScopeDisplay } from "@/lib/s3/scopes";

interface BrowseFolder {
  name: string;
  prefix: string;
}

interface BrowseFile {
  key: string;
  name: string;
  size: number;
}

interface LevelState {
  folders: BrowseFolder[];
  files: BrowseFile[];
  isTruncated: boolean;
  continuationToken?: string;
}

/**
 * Drill-down S3 folder browser for connector onboarding. Lists one level at
 * a time through POST /api/connectors/s3/browse (credentials stay
 * server-side) and reports selected scopes up to the wizard. The bucket
 * root can never be selected — there is no whole-bucket option.
 */
export function S3FolderBrowser({
  accessKeyId,
  secretAccessKey,
  bucket,
  connectorId,
  selected,
  onToggleScope,
  canBrowse,
  single,
}: {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  connectorId?: string | null;
  selected: string[];
  onToggleScope: (scope: string, checked: boolean) => void;
  canBrowse: boolean;
  single?: boolean;
}) {
  const [segments, setSegments] = useState<string[]>([]);
  const prefix = segments.length > 0 ? `${segments.join("/")}/` : "";
  const [levels, setLevels] = useState<Record<string, LevelState>>({});
  const [locked, setLocked] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pattern, setPattern] = useState("");
  const [patternError, setPatternError] = useState<string | null>(null);
  const inFlight = useRef(0);

  const browse = useCallback(
    async (targetPrefix: string, token?: string) => {
      const res = await fetch("/api/connectors/s3/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          connectorId
            ? { connectorId, prefix: targetPrefix, continuationToken: token }
            : { accessKeyId, secretAccessKey, bucket, prefix: targetPrefix, continuationToken: token }
        ),
      });
      const body = (await res.json().catch(() => ({}))) as {
        page?: LevelState;
        error?: string;
      };
      if (!res.ok) {
        const err = new Error(body.error ?? `Browse failed (${res.status})`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      if (!body.page) throw new Error("Browse returned no data");
      return body.page;
    },
    [accessKeyId, secretAccessKey, bucket, connectorId]
  );

  const loadLevel = useCallback(
    async (targetPrefix: string, token?: string) => {
      const id = (inFlight.current += 1);
      if (!token) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const page = await browse(targetPrefix, token);
        if (inFlight.current !== id) return;
        setLevels((prev) => {
          const existing = token ? prev[targetPrefix] : undefined;
          return {
            ...prev,
            [targetPrefix]: {
              folders: [...(existing?.folders ?? []), ...page.folders],
              files: [...(existing?.files ?? []), ...page.files],
              isTruncated: page.isTruncated,
              continuationToken: page.continuationToken,
            },
          };
        });
      } catch (err) {
        if (inFlight.current !== id) return;
        const status = (err as Error & { status?: number }).status;
        if (status === 403 && targetPrefix) {
          // Per-folder denial: lock that row, keep the parent browsable.
          setLocked((prev) => ({ ...prev, [targetPrefix]: (err as Error).message }));
          setError((err as Error).message);
        } else {
          setError((err as Error).message);
        }
      } finally {
        if (inFlight.current === id) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [browse]
  );

  useEffect(() => {
    if (canBrowse) void loadLevel("");
  }, [canBrowse, loadLevel]);

  const drill = (folder: BrowseFolder) => {
    setFilter("");
    setError(null);
    const childPrefix = folder.prefix;
    const childSegments = childPrefix.replace(/\/$/, "").split("/");
    setSegments(childSegments);
    if (!levels[childPrefix] && !locked[childPrefix]) void loadLevel(childPrefix);
  };

  const goTo = (index: number) => {
    // index -1 = root, else first index+1 segments.
    setFilter("");
    setError(null);
    setSegments(index < 0 ? [] : segments.slice(0, index + 1));
  };

  const level = levels[prefix];
  const isFlatRoot =
    prefix === "" && !loading && level != null && level.folders.length === 0 && level.files.length > 0;
  const query = filter.trim().toLowerCase();
  const visibleFolders = (level?.folders ?? []).filter((f) => !query || f.name.toLowerCase().includes(query));
  const visibleFiles = (level?.files ?? []).filter((f) => !query || f.name.toLowerCase().includes(query));

  const submitPaste = async () => {
    const parsed = normalizeScopeInput(paste);
    if (parsed.error || !parsed.scope) {
      setPasteError(parsed.error ?? "Enter a folder path.");
      return;
    }
    setPasteError(null);
    setError(null);
    try {
      const page = await browse(parsed.scope);
      if (page.folders.length === 0 && page.files.length === 0) {
        setPasteError(`"${parsed.scope}" exists but is empty — nothing would be indexed.`);
        return;
      }
      setLevels((prev) => ({ ...prev, [parsed.scope as string]: page }));
      onToggleScope(parsed.scope as string, true);
      setSegments((parsed.scope as string).replace(/\/$/, "").split("/"));
      setPaste("");
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 403) {
        setLocked((prev) => ({ ...prev, [parsed.scope as string]: (err as Error).message }));
        setPasteError(`No access to "${parsed.scope}". It was not selected.`);
      } else if (status === 404) {
        setPasteError(`"${parsed.scope}" was not found in bucket "${bucket}".`);
      } else {
        setPasteError((err as Error).message);
      }
    }
  };

  const submitPattern = () => {
    const parsed = normalizePatternInput(pattern);
    if (parsed.error || !parsed.scope) {
      setPatternError(parsed.error ?? "Enter a filename pattern.");
      return;
    }
    setPatternError(null);
    onToggleScope(parsed.scope, true);
    setPattern("");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800">Which folders should we index?</h3>
        <button
          type="button"
          onClick={() => {
            setLevels({});
            setLocked({});
            void loadLevel(prefix);
          }}
          disabled={!canBrowse || loading}
          className="flex items-center gap-1 text-xs font-semibold text-[#2548C9] hover:underline disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Reload
        </button>
      </div>
      <p className="text-xs text-gray-600">
        Pick specific folders — each becomes its own connector. There is no whole-bucket option; StaffLess only reads
        the folders you check.
      </p>

      {!canBrowse ? (
        <p className="text-sm text-gray-500">Fill in the access key, secret, and bucket name first.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <button
              type="button"
              onClick={() => goTo(-1)}
              className={`flex items-center gap-1 rounded px-1.5 py-1 ${prefix === "" ? "font-semibold text-gray-900" : "text-[#2548C9] hover:underline"}`}
            >
              <Home className="h-3.5 w-3.5" />
              {bucket}
            </button>
            {segments.map((seg, i) => (
              <span key={`${i}-${seg}`} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  className={`rounded px-1.5 py-1 ${i === segments.length - 1 ? "font-semibold text-gray-900" : "text-[#2548C9] hover:underline"}`}
                >
                  {seg}
                </button>
              </span>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitPaste();
                }
              }}
              placeholder="Paste a folder path, e.g. releases/frontend/"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void submitPaste()}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold hover:bg-gray-50"
            >
              Go
            </button>
          </div>
          {pasteError ? <p className="text-sm text-red-700">{pasteError}</p> : null}

          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter this level"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />

          {error && !locked[prefix] ? <p className="text-sm text-red-700">{error}</p> : null}

          {loading && !level ? (
            <div className="space-y-2" aria-label="Loading folders">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />
              ))}
            </div>
          ) : level ? (
            <div className="max-h-64 overflow-auto rounded-lg border border-gray-200 divide-y">
              {prefix !== "" && (
                <div className="flex items-center justify-between gap-2 bg-gray-50 px-3 py-2">
                  <span className="text-xs text-gray-600">
                    {single ? "Indexing scope" : "Everything under"}{" "}
                    <span className="font-mono font-semibold">{prefix}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleScope(prefix, !selected.includes(prefix))}
                    className="rounded-lg bg-[#2548C9] px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    {selected.includes(prefix) ? "Selected ✓" : single ? "Use this folder" : "Select this folder"}
                  </button>
                </div>
              )}
              {visibleFolders.length === 0 && visibleFiles.length === 0 && !isFlatRoot ? (
                <p className="px-3 py-4 text-sm text-gray-500">
                  {query ? "Nothing at this level matches." : "This folder is empty — nothing would be indexed."}
                </p>
              ) : (
                <>
                  {visibleFolders.map((folder) => {
                    const isLocked = locked[folder.prefix] != null;
                    const checked = selected.includes(folder.prefix);
                    return (
                      <div
                        key={folder.prefix}
                        className={`flex items-center gap-2 px-3 py-2 text-sm ${isLocked ? "bg-gray-50 text-gray-400" : "text-gray-800 hover:bg-gray-50"}`}
                      >
                        {isLocked ? <Lock className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0 text-gray-400" />}
                        <input
                          type="checkbox"
                          disabled={isLocked}
                          checked={checked}
                          onChange={(e) => onToggleScope(folder.prefix, e.target.checked)}
                          aria-label={`Select ${folder.prefix}`}
                        />
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={() => drill(folder)}
                          className={`flex-1 truncate text-left font-medium ${isLocked ? "cursor-not-allowed" : "hover:underline"}`}
                          title={isLocked ? locked[folder.prefix] : folder.prefix}
                        >
                          {folder.name}/
                        </button>
                        {isLocked ? (
                          <span className="text-xs font-semibold">No access</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => drill(folder)}
                            className="flex items-center gap-0.5 text-xs font-semibold text-[#2548C9] hover:underline"
                          >
                            Open <ChevronRight className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {visibleFiles.slice(0, 20).map((file) => (
                    <div key={file.key} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500">
                      <span className="w-4 shrink-0" />
                      <span className="w-4 shrink-0" />
                      <span className="flex-1 truncate font-mono">{file.name}</span>
                    </div>
                  ))}
                  {visibleFiles.length > 20 ? (
                    <p className="px-3 py-1.5 text-xs text-gray-400">
                      + {visibleFiles.length - 20} more files at this level (files are indexed, not selected).
                    </p>
                  ) : null}
                </>
              )}
              {level.isTruncated && !query ? (
                <button
                  type="button"
                  onClick={() => void loadLevel(prefix, level.continuationToken)}
                  disabled={loadingMore}
                  className="flex w-full items-center justify-center gap-1 px-3 py-2 text-xs font-semibold text-[#2548C9] hover:bg-gray-50 disabled:opacity-40"
                >
                  {loadingMore ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Show more in this folder
                </button>
              ) : null}
            </div>
          ) : null}

          {isFlatRoot ? (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3">
              <p className="text-sm font-semibold text-amber-900">This bucket has no folders — files sit at the top level.</p>
              <p className="text-xs text-amber-800">
                Scope by the start of the filenames instead. Only files whose names begin with the pattern are indexed.
              </p>
              <div className="flex gap-2">
                <input
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitPattern();
                    }
                  }}
                  placeholder="e.g. invoice-2024-"
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={submitPattern}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                >
                  Add
                </button>
              </div>
              {patternError ? <p className="text-sm text-red-700">{patternError}</p> : null}
            </div>
          ) : null}

          {selected.length > 0 ? (
            <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-xs font-semibold text-gray-700">
                Selected ({selected.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {selected.map((scope) => (
                  <span
                    key={scope}
                    className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 font-mono text-xs text-gray-800 ring-1 ring-gray-200"
                  >
                    {s3ScopeDisplay(scope)}
                    <button
                      type="button"
                      onClick={() => onToggleScope(scope, false)}
                      aria-label={`Remove ${scope}`}
                      className="font-semibold text-gray-400 hover:text-red-700"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
