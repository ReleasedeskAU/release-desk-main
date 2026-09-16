/**
 * Fetch live Bitbucket Cloud repos with the user's email + token.
 * Scoped API tokens cannot use GET /2.0/repositories (deprecated global list).
 * List workspaces, then repos in each workspace. Do not log the token or email.
 */

import { BitbucketProbeError } from "@/lib/bitbucket/probe";

const PAGE_SIZE = 100;
const MAX_REPO_PAGES = 2;
const MAX_WORKSPACES = 10;
const TIMEOUT_MS = 15_000;
const BITBUCKET_API = "https://api.bitbucket.org/2.0";

export type BitbucketRepoOption = {
  fullName: string;
  name: string;
  owner: string;
};

function basicAuth(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`, "utf8").toString("base64")}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function mapOne(raw: unknown): BitbucketRepoOption | null {
  const row = asRecord(raw);
  if (!row) return null;
  const fullName = typeof row.full_name === "string" ? row.full_name.trim() : "";
  const parts = fullName.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : parts[1];
  return { fullName, name, owner: parts[0] };
}

function workspaceSlug(raw: unknown): string | null {
  const row = asRecord(raw);
  if (!row) return null;
  const slug = typeof row.slug === "string" ? row.slug.trim() : "";
  return slug || null;
}

function throwListError(status: number): never {
  if (status === 401) throw new BitbucketProbeError("Bitbucket rejected the credentials.", 401);
  if (status === 403) {
    throw new BitbucketProbeError(
      "Bitbucket denied access to list repositories. Add read:workspace:bitbucket and read:repository:bitbucket.",
      403
    );
  }
  if (status === 400 || status === 404) {
    throw new BitbucketProbeError(
      "This Bitbucket token cannot list repositories. Add read:workspace:bitbucket and read:repository:bitbucket.",
      status
    );
  }
  throw new BitbucketProbeError("Bitbucket rejected the repository list request", Math.min(status, 502));
}

async function getPage(url: string, email: string, token: string): Promise<{ values: unknown[]; next: string | null }> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: basicAuth(email, token),
      Accept: "application/json",
    },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (res.status < 200 || res.status >= 300) throwListError(res.status);
  const rec = asRecord(text ? (JSON.parse(text) as unknown) : {});
  const values = Array.isArray(rec?.values) ? rec.values : [];
  const next = typeof rec?.next === "string" && rec.next.startsWith("https://api.bitbucket.org/") ? rec.next : null;
  return { values, next };
}

async function listWorkspaceSlugs(email: string, token: string): Promise<string[]> {
  const page = await getPage(`${BITBUCKET_API}/workspaces?role=member&pagelen=${PAGE_SIZE}`, email, token);
  const slugs: string[] = [];
  for (const row of page.values) {
    const slug = workspaceSlug(row);
    if (slug) slugs.push(slug);
    if (slugs.length >= MAX_WORKSPACES) break;
  }
  return slugs;
}

async function listReposInWorkspace(
  workspace: string,
  email: string,
  token: string,
  seen: Set<string>,
  out: BitbucketRepoOption[]
): Promise<void> {
  let next: string | null =
    `${BITBUCKET_API}/repositories/${encodeURIComponent(workspace)}?pagelen=${PAGE_SIZE}&sort=full_name`;
  for (let page = 0; page < MAX_REPO_PAGES && next && out.length < PAGE_SIZE * MAX_REPO_PAGES; page += 1) {
    const result = await getPage(next, email, token);
    for (const item of result.values) {
      const mapped = mapOne(item);
      if (!mapped || seen.has(mapped.fullName)) continue;
      seen.add(mapped.fullName);
      out.push(mapped);
      if (out.length >= PAGE_SIZE * MAX_REPO_PAGES) return;
    }
    next = result.next;
  }
}

/**
 * List repositories the token can see (workspace/slug). Caps at 200.
 * @throws BitbucketProbeError on non-2xx or timeout.
 */
export async function fetchBitbucketRepos(email: string, token: string): Promise<BitbucketRepoOption[]> {
  const trimmedEmail = email.trim();
  const trimmedToken = token.trim();
  if (!trimmedEmail || !trimmedToken) {
    throw new BitbucketProbeError("Bitbucket rejected the credentials.", 401);
  }
  try {
    const workspaces = await listWorkspaceSlugs(trimmedEmail, trimmedToken);
    if (workspaces.length === 0) {
      throw new BitbucketProbeError(
        "No Bitbucket workspaces for this token. Add read:workspace:bitbucket.",
        403
      );
    }
    const out: BitbucketRepoOption[] = [];
    const seen = new Set<string>();
    for (const workspace of workspaces) {
      try {
        await listReposInWorkspace(workspace, trimmedEmail, trimmedToken, seen, out);
      } catch (err) {
        if (err instanceof BitbucketProbeError && err.status === 401) throw err;
        if (err instanceof BitbucketProbeError && (err.status === 403 || err.status === 400 || err.status === 404)) {
          continue;
        }
        throw err;
      }
      if (out.length >= PAGE_SIZE * MAX_REPO_PAGES) break;
    }
    if (out.length === 0) {
      throw new BitbucketProbeError(
        "Bitbucket returned no repositories. Add read:repository:bitbucket and confirm the token can see a workspace.",
        403
      );
    }
    out.sort((a, b) => a.fullName.localeCompare(b.fullName));
    return out;
  } catch (err) {
    if (err instanceof BitbucketProbeError) throw err;
    throw new BitbucketProbeError("Bitbucket is unavailable", 502);
  }
}
