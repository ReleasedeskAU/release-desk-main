/**
 * Live Microsoft Teams list for the connector wizard.
 * GET https://graph.microsoft.com/v1.0/teams with the same client-credentials
 * token the indexer uses. Do not log the client secret or the access token.
 */

const GRAPH_HOST = "graph.microsoft.com";
const TOKEN_HOST = "login.microsoftonline.com";
const PAGE_SIZE = 50;
const MAX_PAGES = 40;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TeamsListError extends Error {
  readonly status: number;

  /**
   * @param message - Tenant-safe text. Must not include the secret or token.
   * @param status - HTTP status to return from the list route.
   */
  constructor(message: string, status: number) {
    super(message);
    this.name = "TeamsListError";
    this.status = status;
  }
}

export type TeamOption = {
  fullName: string;
  name: string;
  owner: string;
  detail?: string;
};

type FetchImpl = typeof fetch;

/**
 * Team display names from a picker array or a legacy comma-separated string.
 * @param raw - `config.teams` or the mapped `teamNames` string.
 * @returns Unique trimmed names, original order kept.
 */
export function parseTeamNames(raw: unknown): string[] {
  const parts: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && item.trim()) parts.push(item);
    }
  } else if (typeof raw === "string" && raw.trim()) {
    parts.push(...raw.split(","));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const name = part.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Picker rows for team names already saved on a connector.
 * Edit can show the selection before the live list loads.
 * @param names - Saved display names.
 * @returns Checkbox rows keyed by display name.
 */
export function savedTeamOptions(names: string[]): TeamOption[] {
  return parseTeamNames(names).map((name) => ({
    fullName: name,
    name,
    owner: "saved",
  }));
}

function guid(value: string, label: string): string {
  const trimmed = value.trim();
  if (!GUID.test(trimmed)) {
    throw new TeamsListError(`${label} must be a Microsoft GUID.`, 400);
  }
  return trimmed;
}

/**
 * Only follow Graph's own teams pages. A nextLink to another host is refused.
 */
function graphTeamsUrl(value: string | null): string {
  if (!value) return `https://${GRAPH_HOST}/v1.0/teams?$top=${PAGE_SIZE}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TeamsListError("Microsoft Graph returned an unexpected page link.", 502);
  }
  if (url.protocol !== "https:" || url.hostname !== GRAPH_HOST || !url.pathname.startsWith("/v1.0/teams")) {
    throw new TeamsListError("Microsoft Graph returned an unexpected page link.", 502);
  }
  return url.toString();
}

function presentDate(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Client-credentials token for Graph. The secret and token are not logged.
 * @throws TeamsListError when Microsoft rejects the app or sign-in is down.
 */
async function requestGraphToken(
  clientId: string,
  clientSecret: string,
  directoryId: string,
  fetchImpl: FetchImpl
): Promise<string> {
  const id = guid(clientId, "Application (client) ID");
  const tenant = guid(directoryId, "Directory (tenant) ID");
  const secret = clientSecret.trim();
  if (!secret) throw new TeamsListError("Client secret is required.", 400);
  const tokenBody = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    scope: `https://${GRAPH_HOST}/.default`,
    grant_type: "client_credentials",
  });
  try {
    const tokenRes = await fetchImpl(`https://${TOKEN_HOST}/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });
    if (!tokenRes.ok) {
      const status = tokenRes.status === 400 || tokenRes.status === 401 ? 401 : Math.min(tokenRes.status, 502);
      throw new TeamsListError(
        status === 401 ? "Microsoft rejected the app credentials." : "Microsoft could not issue a token for this app.",
        status
      );
    }
    const token = asRecord(await tokenRes.json())?.access_token;
    if (typeof token !== "string" || !token) {
      throw new TeamsListError("Microsoft could not issue a token for this app.", 502);
    }
    return token;
  } catch (err) {
    if (err instanceof TeamsListError) throw err;
    throw new TeamsListError("Microsoft sign-in is unavailable.", 502);
  }
}

function absorbTeams(rows: unknown[], counts: Map<string, number>): void {
  for (const row of rows) {
    const rec = asRecord(row);
    if (!rec) continue;
    const teamId = typeof rec.id === "string" ? rec.id.trim() : "";
    const displayName = typeof rec.displayName === "string" ? rec.displayName.trim() : "";
    if (!teamId || !displayName) continue;
    if (presentDate(rec.expirationDateTime) || presentDate(rec.deletedDateTime)) continue;
    counts.set(displayName, (counts.get(displayName) ?? 0) + 1);
  }
}

/**
 * Teams this app can access. Display name is the stored scope: the indexer
 * filters GET /teams by displayName, and a shared name matches every team with it.
 * Expired or deleted teams are skipped, matching the indexer.
 * @param clientId - Azure application (client) ID.
 * @param clientSecret - Azure client secret. Never logged.
 * @param directoryId - Azure directory (tenant) ID.
 * @param fetchImpl - HTTP client. Tests pass a fake.
 * @returns Checkbox rows, sorted by display name.
 * @throws TeamsListError when credentials, consent, or Graph paging fail.
 */
export async function fetchTeams(
  clientId: string,
  clientSecret: string,
  directoryId: string,
  fetchImpl: FetchImpl = fetch
): Promise<TeamOption[]> {
  const accessToken = await requestGraphToken(clientId, clientSecret, directoryId, fetchImpl);
  const counts = new Map<string, number>();
  let next: string | null = null;
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await fetchImpl(graphTeamsUrl(next), {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (res.status === 401) throw new TeamsListError("Microsoft rejected the app credentials.", 401);
      if (res.status === 403) {
        throw new TeamsListError(
          "This app cannot list teams. It needs the Microsoft Graph application permission Team.ReadBasic.All with admin consent.",
          403
        );
      }
      if (!res.ok) throw new TeamsListError("Microsoft Graph could not list teams.", Math.min(res.status, 502));
      const json = asRecord(await res.json());
      absorbTeams(Array.isArray(json?.value) ? json.value : [], counts);
      const link = json?.["@odata.nextLink"];
      if (typeof link !== "string" || !link.trim()) break;
      graphTeamsUrl(link);
      if (page === MAX_PAGES - 1) {
        throw new TeamsListError("This tenant has more teams than the picker can load.", 502);
      }
      next = link;
    }
  } catch (err) {
    if (err instanceof TeamsListError) throw err;
    throw new TeamsListError("Microsoft Graph is unavailable.", 502);
  }
  return [...counts.entries()]
    .map(([displayName, count]) => ({
      fullName: displayName,
      name: displayName,
      owner: "team",
      ...(count > 1 ? { detail: `${count} teams share this name — all of them will be indexed` } : {}),
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}
