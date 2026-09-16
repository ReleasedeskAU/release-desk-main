"use client";

import { Loader2, RefreshCw } from "lucide-react";
import type { GithubRepoOption } from "@/lib/github/projects";

export function GithubRepoPicker({
  repos,
  loading,
  error,
  filter,
  onFilter,
  allRepos,
  allReposOwner,
  selectedFullNames,
  onToggleAllRepos,
  onToggleRepo,
  onReload,
  canReload,
  heading = "Which GitHub repositories should we copy?",
  loadLabel = "Load repositories",
  loadingLabel = "Asking GitHub for the repository list…",
  emptyLabel = "No repositories loaded yet. Click Load repositories.",
  allCheckedLabel,
  allDisabledHint = "Select repositories from one owner to copy every repo for that owner",
  hideAllOption = false,
  selectedHint,
  filterPlaceholder = "Search by owner or name",
}: {
  repos: GithubRepoOption[];
  loading: boolean;
  error: string | null;
  filter: string;
  onFilter: (value: string) => void;
  allRepos: boolean;
  allReposOwner: string | null;
  selectedFullNames: string[];
  onToggleAllRepos: (value: boolean) => void;
  onToggleRepo: (fullName: string, checked: boolean) => void;
  onReload: () => void;
  canReload: boolean;
  heading?: string;
  loadLabel?: string;
  loadingLabel?: string;
  emptyLabel?: string;
  allCheckedLabel?: (owner: string) => string;
  allDisabledHint?: string;
  hideAllOption?: boolean;
  selectedHint?: (count: number, ownerCount: number) => string;
  filterPlaceholder?: string;
}) {
  const visible = repos.filter((repo) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return repo.fullName.toLowerCase().includes(q) || repo.name.toLowerCase().includes(q);
  });
  const selectedNotInList = selectedFullNames.filter((name) => !repos.some((r) => r.fullName === name));
  const owners = new Set(selectedFullNames.map((name) => name.split("/")[0]).filter(Boolean));
  const singleOwner = owners.size === 1 ? [...owners][0] : allReposOwner;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800">{heading}</h3>
        <button
          type="button"
          onClick={onReload}
          disabled={!canReload || loading}
          className="flex items-center gap-1 text-xs font-semibold text-[#2548C9] hover:underline disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {loadLabel}
        </button>
      </div>
      {!hideAllOption ? (
      <label className={`flex items-start gap-2 text-sm ${singleOwner ? "text-gray-700" : "text-gray-400"}`}>
        <input
          type="checkbox"
          checked={allRepos}
          disabled={!singleOwner}
          onChange={(e) => onToggleAllRepos(e.target.checked)}
        />
        <span>
          {singleOwner
            ? (allCheckedLabel ? allCheckedLabel(singleOwner) : `Every repository for ${singleOwner}`)
            : allDisabledHint}
        </span>
      </label>
      ) : null}
      <input
        value={filter}
        onChange={(e) => onFilter(e.target.value)}
        disabled={allRepos}
        placeholder={filterPlaceholder}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
      />
      {error && <p className="text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-gray-500">{loadingLabel}</p>}
      {!loading && !allRepos && (
        <div className="max-h-64 overflow-auto rounded-lg border border-gray-200 divide-y">
          {visible.length === 0 && selectedNotInList.length === 0 ? (
            <p className="px-3 py-4 text-sm text-gray-500">{emptyLabel}</p>
          ) : (
            <>
              {visible.map((repo) => (
                <label key={repo.fullName} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedFullNames.includes(repo.fullName)}
                    onChange={(e) => onToggleRepo(repo.fullName, e.target.checked)}
                  />
                  <span className="font-semibold">{repo.fullName}</span>
                  {repo.private ? <span className="text-xs text-gray-500">Private</span> : null}
                </label>
              ))}
              {selectedNotInList.map((fullName) => (
                <label key={fullName} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50">
                  <input type="checkbox" checked onChange={(e) => onToggleRepo(fullName, e.target.checked)} />
                  <span className="font-semibold">{fullName}</span>
                  <span className="text-gray-500">Already saved on this connector</span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
      {!allRepos && selectedFullNames.length > 0 && (
        <p className="text-xs text-gray-500">
          {selectedHint
            ? selectedHint(selectedFullNames.length, owners.size)
            : `${selectedFullNames.length} selected${
                owners.size > 1
                  ? ` across ${owners.size} owners — one StaffLess connector is created per owner.`
                  : " — one StaffLess connector covers them."
              }`}
        </p>
      )}
    </div>
  );
}
