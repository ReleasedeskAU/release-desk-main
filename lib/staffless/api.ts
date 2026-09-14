/**
 * StaffLess AI connector + document operations used by Sentinel API routes.
 */

import { StafflessApiError, stafflessFetch } from "@/lib/staffless/client";
import { planCatalogCreate, type CatalogCreateInput } from "@/lib/admin-connectors/plan-create";
import {
  assertBitbucketConnectorReachable,
  BITBUCKET_ENGINE_STALE_CHECK,
  isStaleBitbucketEngineCheck,
} from "@/lib/bitbucket/probe";
import {
  isStafflessConnectorType,
  planStafflessConnector,
  planStafflessCreate,
  type WizardConnectorInput,
  type WizardCreateInput,
} from "@/lib/staffless/create-payload";
import { findRowByStafflessId, requireCcPairId, requireSingleCredentialId, StafflessIdError } from "@/lib/staffless/ids";
import { mapIndexAttemptPage, mapIndexErrorPage } from "@/lib/staffless/map-index-attempts";
import { buildSyncLogsView, type SyncLogsView } from "@/lib/staffless/map-sync-logs";
import {
  flattenIndexingStatusPayload,
  mergeCcPairsWithIndexingStatus,
  type ConnectorTableRow,
  type StafflessCcPairStatus,
} from "@/lib/staffless/map-indexing-status";
import {
  mapSearchDocsToWorkItems,
  type StafflessSearchDoc,
  type WorkItemRow,
} from "@/lib/staffless/map-search-docs";

type IdResponse = { id?: number };

type EngineConnectorRow = {
  id: number;
  name: string;
  source: string;
  credential_ids?: number[];
};

async function quietlyDelete(path: string): Promise<void> {
  try {
    await stafflessFetch(path, { method: "DELETE" });
  } catch {
    // Best-effort cleanup after a failed create. The original error is returned.
  }
}

/**
 * Remove an unpaired connector with this name and source (failed create leftover).
 */
async function deleteUnpairedConnector(name: string, source: string): Promise<void> {
  const rows = await stafflessFetch<EngineConnectorRow[]>("/api/manage/admin/connector");
  const orphan = (Array.isArray(rows) ? rows : []).find(
    (row) => row.name === name && row.source === source && !(row.credential_ids?.length)
  );
  if (!orphan) return;
  await quietlyDelete(`/api/manage/admin/connector/${orphan.id}`);
}

async function createEngineConnector(body: { name: string; source: string }): Promise<number> {
  const json = body as unknown as Record<string, unknown>;
  try {
    const connector = await stafflessFetch<IdResponse>("/api/manage/admin/connector", { json });
    if (connector?.id == null) throw new Error("Index engine did not return a connector id");
    return connector.id;
  } catch (err) {
    if (!(err instanceof StafflessApiError) || err.status !== 400) throw err;
    await deleteUnpairedConnector(body.name, body.source);
    const retry = await stafflessFetch<IdResponse>("/api/manage/admin/connector", { json });
    if (retry?.id == null) throw err;
    return retry.id;
  }
}

async function pairEngineCredential(
  connectorId: number,
  credentialId: number,
  name: string
): Promise<void> {
  try {
    await stafflessFetch(`/api/manage/connector/${connectorId}/credential/${credentialId}`, {
      method: "PUT",
      json: { name, access_type: "public", groups: [] },
    });
  } catch (err) {
    await quietlyDelete(`/api/manage/admin/connector/${connectorId}`);
    await quietlyDelete(`/api/manage/admin/credential/${credentialId}`);
    throw err;
  }
}

export { isStafflessConnectorType, StafflessIdError };

/**
 * List cc-pairs from GET /admin/connector/status, joined to indexing-status by cc_pair_id.
 * Credential JSON from the status payload is not copied onto the row.
 */
export async function listStafflessConnectors(): Promise<ConnectorTableRow[]> {
  const [pairs, statusPayload] = await Promise.all([
    stafflessFetch<StafflessCcPairStatus[]>("/api/manage/admin/connector/status"),
    stafflessFetch<unknown>("/api/manage/admin/connector/indexing-status", {
      json: { get_all_connectors: true },
    }),
  ]);
  return mergeCcPairsWithIndexingStatus(Array.isArray(pairs) ? pairs : [], flattenIndexingStatusPayload(statusPayload));
}

export async function refreshStafflessConnectorStatus(): Promise<ConnectorTableRow[]> {
  return listStafflessConnectors();
}

export async function findStafflessConnector(id: string): Promise<ConnectorTableRow | null> {
  const rows = await listStafflessConnectors();
  return findRowByStafflessId(rows, id);
}

export async function createStafflessConnector(input: WizardCreateInput): Promise<{ id: number }> {
  const plan = planStafflessCreate(input);
  const credential = await stafflessFetch<IdResponse>("/api/manage/credential", {
    json: plan.credential,
  });
  const credentialId = credential?.id;
  if (credentialId == null) throw new Error("Index engine did not return a credential id");
  const connectorId = await createEngineConnector(plan.connector);
  await pairEngineCredential(connectorId, credentialId, input.name);
  return { id: connectorId };
}

/**
 * Create from the Admin Connectors catalog (any ready source).
 * Sources with no credential fields use the engine mock-credential path.
 */
async function preflightCatalogCreate(plan: ReturnType<typeof planCatalogCreate>): Promise<void> {
  if (plan.connector.source !== "bitbucket") return;
  const creds = plan.credential.credential_json;
  const config = plan.connector.connector_specific_config;
  await assertBitbucketConnectorReachable({
    email: String(creds.bitbucket_email ?? ""),
    token: String(creds.bitbucket_api_token ?? ""),
    workspace: String(config.workspace ?? ""),
    repositories: typeof config.repositories === "string" ? config.repositories : undefined,
  });
}

export async function createCatalogStafflessConnector(input: CatalogCreateInput): Promise<{ id: number }> {
  const plan = planCatalogCreate(input);
  await preflightCatalogCreate(plan);
  if (Object.keys(plan.credential.credential_json).length === 0) {
    const connector = await stafflessFetch<IdResponse>("/api/manage/admin/connector-with-mock-credential", {
      json: plan.connector,
    });
    const connectorId = connector?.id;
    if (connectorId == null) {
      throw new Error("Index engine did not return a connector id");
    }
    return { id: connectorId };
  }
  const credential = await stafflessFetch<IdResponse>("/api/manage/credential", {
    json: plan.credential,
  });
  const credentialId = credential?.id;
  if (credentialId == null) throw new Error("Index engine did not return a credential id");
  const connectorId = await createEngineConnector(plan.connector);
  try {
    await pairEngineCredential(connectorId, credentialId, input.name.trim());
  } catch (err) {
    if (
      plan.connector.source === "bitbucket" &&
      err instanceof StafflessApiError &&
      isStaleBitbucketEngineCheck(err.message)
    ) {
      throw new StafflessApiError(400, BITBUCKET_ENGINE_STALE_CHECK);
    }
    throw err;
  }
  return { id: connectorId };
}

export type StafflessUpdateInput = WizardConnectorInput & {
  credentials?: Record<string, string>;
};

/**
 * PATCH connector config, optionally PUT credentials, and rename the cc-pair.
 * @throws StafflessIdError when the pair or credential cannot be resolved.
 */
export async function updateStafflessConnector(row: ConnectorTableRow, input: StafflessUpdateInput): Promise<void> {
  const connectorId = Number(row.id);
  const ccPairId = requireCcPairId(row.ccPairId);
  const connector = planStafflessConnector({ ...input, type: row.type });
  await stafflessFetch(`/api/manage/admin/connector/${connectorId}`, {
    method: "PATCH",
    json: connector,
  });
  if (input.name.trim()) {
    await stafflessFetch(`/api/manage/admin/cc-pair/${ccPairId}/name?new_name=${encodeURIComponent(input.name.trim())}`, {
      method: "PUT",
    });
  }
  if (input.credentials && Object.keys(input.credentials).length > 0) {
    const credentialId = requireSingleCredentialId(row.credentialIds);
    const plan = planStafflessCreate({
      name: input.name,
      type: row.type,
      baseUrl: input.baseUrl,
      config: input.config,
      pollInterval: input.pollInterval,
      credentials: input.credentials,
    });
    await stafflessFetch(`/api/manage/admin/credential/${credentialId}`, {
      method: "PUT",
      json: { name: plan.credential.name, credential_json: plan.credential.credential_json },
    });
  }
}

export async function setStafflessConnectorPaused(row: ConnectorTableRow, paused: boolean): Promise<void> {
  const ccPairId = requireCcPairId(row.ccPairId);
  await stafflessFetch(`/api/manage/admin/cc-pair/${ccPairId}/status`, {
    method: "PUT",
    json: { status: paused ? "PAUSED" : "ACTIVE" },
  });
}

/**
 * Schedule document + pair deletion. Indexed copies are removed; the source system is not.
 * @throws StafflessIdError when credential id is missing or ambiguous.
 */
export async function deleteStafflessConnector(row: ConnectorTableRow): Promise<void> {
  const credentialId = requireSingleCredentialId(row.credentialIds);
  await stafflessFetch("/api/manage/admin/deletion-attempt", {
    json: { connector_id: Number(row.id), credential_id: credentialId },
  });
}

export async function runStafflessConnectorOnce(connectorId: number, fromBeginning = false): Promise<void> {
  await stafflessFetch("/api/manage/admin/connector/run-once", {
    json: { connector_id: connectorId, from_beginning: fromBeginning },
  });
}

export async function pruneStafflessConnector(row: ConnectorTableRow): Promise<void> {
  const ccPairId = requireCcPairId(row.ccPairId);
  await stafflessFetch(`/api/manage/admin/cc-pair/${ccPairId}/prune`, { method: "POST" });
}

/** Index attempts for this cc-pair. Newest first. @throws StafflessIdError when unbound. */
export async function listStafflessIndexAttempts(row: ConnectorTableRow) {
  const ccPairId = requireCcPairId(row.ccPairId);
  const payload = await stafflessFetch<unknown>(
    `/api/manage/admin/cc-pair/${ccPairId}/index-attempts?page_num=0&page_size=50`
  );
  return mapIndexAttemptPage(payload);
}

/** Unresolved index errors for this cc-pair. @throws StafflessIdError when unbound. */
export async function listStafflessIndexErrors(row: ConnectorTableRow) {
  const ccPairId = requireCcPairId(row.ccPairId);
  const payload = await stafflessFetch<unknown>(
    `/api/manage/admin/cc-pair/${ccPairId}/errors?include_resolved=false&page_num=0&page_size=50`
  );
  return mapIndexErrorPage(payload);
}

/**
 * Indexing-status plus attempts and unresolved errors for the sync-logs drawer.
 * @throws StafflessIdError when the cc-pair is missing.
 */
export async function listStafflessSyncLogs(row: ConnectorTableRow): Promise<SyncLogsView> {
  const [attempts, errors] = await Promise.all([listStafflessIndexAttempts(row), listStafflessIndexErrors(row)]);
  return buildSyncLogsView({ connector: row, attempts, errors });
}

export async function searchStafflessWorkItems(query: string, source?: string): Promise<WorkItemRow[]> {
  const filters: Record<string, unknown> = {};
  if (source) filters.source_type = [source.toLowerCase()];
  const body = await stafflessFetch<{ documents?: StafflessSearchDoc[] }>("/api/admin/search", {
    json: { query: query.trim(), filters },
  });
  return mapSearchDocsToWorkItems(body?.documents ?? []);
}
