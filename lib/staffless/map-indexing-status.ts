/**
 * Map StaffLess cc-pair + indexing-status onto the System Connectors table.
 * Join key is `cc_pair_id` from the engine — not display name.
 * Credential JSON from `/admin/connector/status` is ignored on purpose.
 */

import { parseGeneratedJiraProjectJql } from "@/lib/jira/project-keys";
import { toPositiveStafflessId } from "@/lib/staffless/ids";

/** Quiet list refresh while a deletion job is in progress. */
export const CONNECTOR_DELETING_POLL_MS = 4_000;

export type StafflessIndexingStatus = {
  cc_pair_id?: number;
  name?: string;
  source?: string;
  cc_pair_status?: string;
  in_progress?: boolean;
  in_repeated_error_state?: boolean;
  last_status?: string | null;
  last_finished_status?: string | null;
  last_success?: string | null;
  docs_indexed?: number;
  latest_index_attempt_docs_indexed?: number | null;
};

export type StafflessConnectorSnapshot = {
  id: number;
  name: string;
  source: string;
  credential_ids?: number[];
  connector_specific_config?: Record<string, unknown>;
  refresh_freq?: number | null;
  indexing_start?: string | null;
  time_created?: string;
  time_updated?: string;
};

/** `/admin/connector/status` row. Do not read `credential.credential_json`. */
export type StafflessCcPairStatus = {
  cc_pair_id?: number;
  name?: string;
  connector?: StafflessConnectorSnapshot;
  credential?: { id?: number | string };
};

export type ConnectorTableRow = {
  id: string;
  ccPairId: number | null;
  credentialIds: number[];
  name: string;
  type: string;
  authType: string;
  baseUrl: string | null;
  config: Record<string, unknown> | null;
  pollInterval: number;
  status: string;
  lastSyncedAt: string | null;
  lastStatus: string | null;
  lastFinishedStatus: string | null;
  lastError: string | null;
  /** True when the latest index failure looks like a revoked/invalid token. */
  reconnectRequired?: boolean;
  enabled: boolean;
  docsIndexed: number;
  latestAttemptDocsIndexed: number | null;
  inProgress: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  indexingStart: string | null;
};

const HIDDEN_SOURCES = new Set(["ingestion_api"]);

function sourceToType(source: string | undefined): string {
  return (source ?? "unknown").toLowerCase();
}

function authTypeFor(type: string): string {
  if (type === "jira" || type === "imap" || type === "bitbucket") return "basic_token";
  return "api_key";
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const parts = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    return parts.length > 0 ? parts.join(", ") : undefined;
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function githubDataTypes(cfg: Record<string, unknown>): string[] {
  const types: string[] = [];
  if (cfg.include_prs !== false) types.push("pull_requests");
  if (cfg.include_issues === true) types.push("issues");
  if (cfg.include_overview !== false) types.push("repository_overview");
  if (cfg.include_commits !== false) types.push("commits");
  if (cfg.include_files === true) types.push("files");
  return types;
}

function gitlabDataTypes(cfg: Record<string, unknown>): string[] {
  const types: string[] = [];
  if (cfg.include_mrs !== false) types.push("pull_requests");
  if (cfg.include_issues !== false) types.push("issues");
  if (cfg.include_overview !== false) types.push("repository_overview");
  if (cfg.include_commits !== false) types.push("commits");
  return types;
}

function bitbucketDataTypes(cfg: Record<string, unknown>): string[] {
  const types: string[] = [];
  if (cfg.include_prs !== false) types.push("pull_requests");
  if (cfg.include_repo !== false || cfg.include_readme !== false) types.push("repository_overview");
  if (cfg.include_commits !== false) types.push("commits");
  return types;
}

function wizardDataTypes(type: string, cfg: Record<string, unknown>): string[] | undefined {
  if (type === "github") return githubDataTypes(cfg);
  if (type === "gitlab") return gitlabDataTypes(cfg);
  if (type === "bitbucket") return bitbucketDataTypes(cfg);
  return undefined;
}

/**
 * Deletion-attempt needs this pair's credential, not every credential on the connector.
 * Prefer `pair.credential.id`; fall back to connector.credential_ids only when the pair omits it.
 */
function credentialIdsFrom(connector: StafflessConnectorSnapshot, pair: StafflessCcPairStatus): number[] {
  const fromPair = toPositiveStafflessId(pair.credential?.id);
  if (fromPair != null) return [fromPair];
  return (connector.credential_ids ?? []).map(toPositiveStafflessId).filter((id): id is number => id != null);
}

/**
 * Translate StaffLess index attempt status into the existing badge keys.
 */
export function mapIndexingStatusToBadge(
  row: StafflessIndexingStatus
): { status: string; enabled: boolean; lastError: string | null } {
  const pairStatus = (row.cc_pair_status ?? "").toUpperCase();
  if (pairStatus === "DELETING") {
    return { status: "DELETING", enabled: false, lastError: null };
  }
  if (pairStatus === "PAUSED") {
    return { status: "DISABLED", enabled: false, lastError: null };
  }
  if (row.in_progress || row.last_status === "in_progress") {
    return { status: "PENDING", enabled: true, lastError: null };
  }
  const finished = row.last_finished_status ?? row.last_status;
  if (finished === "failed") {
    return { status: "ERROR", enabled: true, lastError: "Last index run failed" };
  }
  if (finished === "success" || finished === "completed_with_errors") {
    return { status: "CONNECTED", enabled: true, lastError: null };
  }
  return { status: "PENDING", enabled: true, lastError: null };
}

export function mapConnectorToTableRow(
  connector: StafflessConnectorSnapshot,
  status: StafflessIndexingStatus | undefined,
  pair?: StafflessCcPairStatus
): ConnectorTableRow {
  const badge = mapIndexingStatusToBadge(status ?? {});
  const cfg = connector.connector_specific_config ?? {};
  const type = sourceToType(connector.source);
  const host = typeof cfg.host === "string" ? cfg.host : undefined;
  const baseUrl =
    typeof cfg.jira_base_url === "string"
      ? cfg.jira_base_url
      : typeof cfg.github_base_url === "string"
        ? cfg.github_base_url
        : typeof cfg.gitlab_url === "string"
          ? cfg.gitlab_url
          : host ?? null;
  const projectKey = typeof cfg.project_key === "string" ? cfg.project_key : undefined;
  const jqlQuery = typeof cfg.jql_query === "string" ? cfg.jql_query : undefined;
  const jqlKeys = parseGeneratedJiraProjectJql(jqlQuery);
  const projectKeys = jqlKeys ?? (projectKey ? [projectKey] : undefined);
  const allProjects = type === "jira" && !projectKey && !jqlQuery;
  const repoOwner = typeof cfg.repo_owner === "string" ? cfg.repo_owner : "";
  const repositories = typeof cfg.repositories === "string" ? cfg.repositories : "";
  const repoNames = repositories
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const githubRepos =
    repoOwner && repoNames.length > 0 ? repoNames.map((name) => (name.includes("/") ? name : `${repoOwner}/${name}`)) : undefined;
  const allRepos = type === "github" && Boolean(repoOwner) && repoNames.length === 0;
  const repo =
    githubRepos && githubRepos.length === 1
      ? githubRepos[0]
      : repoOwner && repositories && !repositories.includes(",")
        ? `${repoOwner}/${repositories}`
        : undefined;
  const teamNames = stringList(cfg.teams);
  const mailboxes = stringList(cfg.mailboxes);
  const allowedSenders = stringList(cfg.allowed_senders);
  const port =
    typeof cfg.port === "number"
      ? String(cfg.port)
      : typeof cfg.port === "string" && cfg.port.trim()
        ? cfg.port.trim()
        : undefined;
  const gitlabPaths: string[] = [];
  if (type === "gitlab") {
    if (typeof cfg.projects === "string") {
      gitlabPaths.push(
        ...cfg.projects
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      );
    }
    if (gitlabPaths.length === 0) {
      const owner = typeof cfg.project_owner === "string" ? cfg.project_owner.trim() : "";
      const name = typeof cfg.project_name === "string" ? cfg.project_name.trim() : "";
      if (owner && name) gitlabPaths.push(`${owner}/${name}`);
    }
  }
  const bitbucketWorkspace = type === "bitbucket" && typeof cfg.workspace === "string" ? cfg.workspace.trim() : "";
  const bitbucketSlugs =
    type === "bitbucket"
      ? (typeof cfg.repositories === "string" ? cfg.repositories : "")
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      : [];
  const bitbucketRepos =
    bitbucketWorkspace && bitbucketSlugs.length > 0
      ? bitbucketSlugs.map((slug) => (slug.includes("/") ? slug : `${bitbucketWorkspace}/${slug}`))
      : undefined;
  const allBitbucketRepos = type === "bitbucket" && Boolean(bitbucketWorkspace) && bitbucketSlugs.length === 0;
  const dataTypes = wizardDataTypes(type, cfg);

  return {
    id: String(connector.id),
    ccPairId: pair?.cc_pair_id ?? status?.cc_pair_id ?? null,
    credentialIds: pair
      ? credentialIdsFrom(connector, pair)
      : (connector.credential_ids ?? []).map(toPositiveStafflessId).filter((id): id is number => id != null),
    name: pair?.name?.trim() || connector.name,
    type,
    authType: authTypeFor(type),
    baseUrl,
    config: {
      ...(projectKey ? { projectKey } : {}),
      ...(projectKeys ? { projectKeys } : {}),
      ...(allProjects ? { allProjects: true } : {}),
      ...(jqlQuery && !jqlKeys ? { jqlQuery } : {}),
      ...(repo ? { repo } : {}),
      ...(repoOwner ? { repoOwner } : {}),
      ...(githubRepos ? { repos: githubRepos } : {}),
      ...(allRepos ? { allRepos: true } : {}),
      ...(gitlabPaths.length > 0 ? { projects: gitlabPaths } : {}),
      ...(bitbucketWorkspace ? { workspace: bitbucketWorkspace } : {}),
      ...(bitbucketRepos ? { repos: bitbucketRepos } : {}),
      ...(allBitbucketRepos ? { allRepos: true } : {}),
      ...(teamNames ? { teamNames } : {}),
      ...(host ? { host } : {}),
      ...(port ? { port } : {}),
      ...(mailboxes ? { mailboxes } : {}),
      ...(allowedSenders ? { allowedSenders } : {}),
      ...(dataTypes ? { dataTypes } : {}),
    },
    pollInterval: connector.refresh_freq ? Math.max(1, Math.round(connector.refresh_freq / 60)) : 15,
    status: badge.status,
    lastSyncedAt: optionalString(status?.last_success),
    lastStatus: optionalString(status?.last_status),
    lastFinishedStatus: optionalString(status?.last_finished_status),
    lastError: badge.lastError,
    reconnectRequired: false,
    enabled: badge.enabled,
    docsIndexed: optionalCount(status?.docs_indexed) ?? 0,
    latestAttemptDocsIndexed: optionalCount(status?.latest_index_attempt_docs_indexed),
    inProgress: status?.in_progress === true || status?.last_status === "in_progress",
    createdBy: null,
    createdAt: connector.time_created ?? new Date(0).toISOString(),
    updatedAt: connector.time_updated ?? connector.time_created ?? new Date(0).toISOString(),
    indexingStart: connector.indexing_start ?? null,
  };
}

/**
 * indexing-status returns one group per source, each with indexing_statuses[].
 */
export function flattenIndexingStatusPayload(payload: unknown): StafflessIndexingStatus[] {
  if (!Array.isArray(payload)) return [];
  const out: StafflessIndexingStatus[] = [];
  for (const group of payload) {
    if (!group || typeof group !== "object") continue;
    const rows = (group as { indexing_statuses?: unknown }).indexing_statuses;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row && typeof row === "object") out.push(row as StafflessIndexingStatus);
    }
  }
  return out;
}

/**
 * Join GET /admin/connector/status to indexing-status by cc_pair_id.
 * Pairs without a connector id are skipped (not guessed).
 */
export function mergeCcPairsWithIndexingStatus(
  pairs: StafflessCcPairStatus[],
  statuses: StafflessIndexingStatus[]
): ConnectorTableRow[] {
  const byCcPairId = new Map<number, StafflessIndexingStatus>();
  for (const status of statuses) {
    if (typeof status.cc_pair_id === "number") byCcPairId.set(status.cc_pair_id, status);
  }
  const rows: ConnectorTableRow[] = [];
  for (const pair of pairs) {
    const connector = pair.connector;
    if (!connector || typeof connector.id !== "number" || connector.id <= 0) continue;
    if (HIDDEN_SOURCES.has(sourceToType(connector.source))) continue;
    const ccPairId = typeof pair.cc_pair_id === "number" ? pair.cc_pair_id : null;
    const status = ccPairId != null ? byCcPairId.get(ccPairId) : undefined;
    rows.push(mapConnectorToTableRow(connector, status, pair));
  }
  return rows;
}

/**
 * Legacy name+source join used only in older tests. Prefer mergeCcPairsWithIndexingStatus.
 */
export function mergeConnectorsWithStatus(
  connectors: StafflessConnectorSnapshot[],
  statuses: StafflessIndexingStatus[]
): ConnectorTableRow[] {
  return connectors.map((connector) => {
    const type = sourceToType(connector.source);
    const match =
      statuses.find((s) => s.name === connector.name && sourceToType(s.source) === type) ??
      statuses.find((s) => s.name === connector.name);
    return mapConnectorToTableRow(connector, match);
  });
}
