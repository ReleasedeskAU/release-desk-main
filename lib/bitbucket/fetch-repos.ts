/**
 * Fetch live Bitbucket Cloud repos with email + scoped API token.
 * These tokens cannot list every workspace. Caller must pass the workspace slug
 * (acme in bitbucket.org/acme/app). Do not log the token or email.
 */

import {
  assertBitbucketEmailAndToken,
  BITBUCKET_INVALID_CREDENTIALS,
  BitbucketProbeError,
} from "@/lib/bitbucket/probe";

const PAGE_SIZE = 100;
const MAX_REPO_PAGES = 2;
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

function mapRepo(raw: unknown): BitbucketRepoOption | null {
  const row = asRecord(raw);
  if (!row) return null;
  const fullName = typeof row.full_name === "string" ? row.full_name.trim() : "";
  const parts = fullName.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : parts[1];
  return { fullName, name, owner: parts[0] };
}

function throwListError(status: number): never {
  if (status === 401) throw new BitbucketProbeError(BITBUCKET_INVALID_CREDENTIALS, 401);
  if (status === 403) throw new BitbucketProbeError("Bitbucket denied access to that workspace.", 403);
  if (status === 404) {
    throw new BitbucketProbeError(
      "Bitbucket could not find that workspace. Use the slug from bitbucket.org/{workspace}/repo.",
      404
    );
  }
  throw new BitbucketProbeError("Bitbucket could not list repositories for this token.", Math.min(status, 502));
}

/**
 * List repositories in one workspace. Caps at 200.
 * @throws BitbucketProbeError on non-2xx or timeout.
 */
export async function fetchBitbucketRepos(
  email: string,
  token: string,
  workspace: string
): Promise<BitbucketRepoOption[]> {
  const { email: trimmedEmail, token: trimmedToken } = assertBitbucketEmailAndToken(email, token);
  const slug = workspace.trim();
  if (!slug) {
    throw new BitbucketProbeError(
      "Enter the Bitbucket workspace slug from the repo URL (acme in bitbucket.org/acme/app).",
      400
    );
  }
  const out: BitbucketRepoOption[] = [];
  const seen = new Set<string>();
  let next: string | null =
    `${BITBUCKET_API}/repositories/${encodeURIComponent(slug)}?pagelen=${PAGE_SIZE}&sort=full_name`;
  try {
    for (let page = 0; page < MAX_REPO_PAGES && next; page += 1) {
      const res = await fetch(next, {
        method: "GET",
        headers: {
          Authorization: basicAuth(trimmedEmail, trimmedToken),
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
      next = typeof rec?.next === "string" && rec.next.startsWith("https://api.bitbucket.org/") ? rec.next : null;
      for (const item of values) {
        const mapped = mapRepo(item);
        if (!mapped || seen.has(mapped.fullName)) continue;
        seen.add(mapped.fullName);
        out.push(mapped);
      }
    }
  } catch (err) {
    if (err instanceof BitbucketProbeError) throw err;
    throw new BitbucketProbeError("Bitbucket is unavailable", 502);
  }
  out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return out;
}
