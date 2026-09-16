/**
 * Fetch live Bitbucket Cloud repos with the user's email + token.
 * Runs on the Next.js server only. Do not log the token or email.
 */

import { BitbucketProbeError } from "@/lib/bitbucket/probe";

const PAGE_SIZE = 100;
const MAX_PAGES = 2;
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
  const out: BitbucketRepoOption[] = [];
  const seen = new Set<string>();
  let next: string | null =
    `${BITBUCKET_API}/repositories?role=member&pagelen=${PAGE_SIZE}&sort=full_name`;
  for (let page = 0; page < MAX_PAGES && next; page += 1) {
    let values: unknown[];
    let nextUrl: string | null = null;
    try {
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
      if (res.status === 401) throw new BitbucketProbeError("Bitbucket rejected the credentials.", 401);
      if (res.status === 403) {
        throw new BitbucketProbeError("Bitbucket denied access to list repositories.", 403);
      }
      if (res.status < 200 || res.status >= 300) {
        throw new BitbucketProbeError("Bitbucket rejected the repository list request", Math.min(res.status, 502));
      }
      const body = text ? (JSON.parse(text) as unknown) : {};
      const rec = asRecord(body);
      values = Array.isArray(rec?.values) ? rec.values : [];
      nextUrl = typeof rec?.next === "string" && rec.next.startsWith("https://api.bitbucket.org/") ? rec.next : null;
    } catch (err) {
      if (err instanceof BitbucketProbeError) throw err;
      throw new BitbucketProbeError("Bitbucket is unavailable", 502);
    }
    for (const item of values) {
      const mapped = mapOne(item);
      if (!mapped || seen.has(mapped.fullName)) continue;
      seen.add(mapped.fullName);
      out.push(mapped);
    }
    next = nextUrl;
  }
  out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return out;
}
