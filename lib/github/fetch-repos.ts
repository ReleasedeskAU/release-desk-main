/**
 * Fetch live GitHub repos with the user's PAT.
 * Runs on the Next.js server only. Do not log the token.
 */

import { mapGithubRepoListPayload, type GithubRepoOption } from "@/lib/github/projects";

const PAGE_SIZE = 100;
const MAX_PAGES = 2;
const TIMEOUT_MS = 15_000;
const GITHUB_API = "https://api.github.com";
export const GITHUB_TOKEN_MAX_CHARS = 500;

export class GithubReposFetchError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GithubReposFetchError";
    this.status = status;
  }
}

/** Client-safe GitHub status copy. Never include response bodies (may leak). */
export function publicGithubHttpMessage(status: number): string {
  if (status === 401) {
    return "GitHub rejected that token. It is invalid or has been revoked.";
  }
  if (status === 403) {
    return "This GitHub token cannot list repositories. Check repo access and organization SSO authorization.";
  }
  if (status === 404) return "GitHub could not list repositories for this token";
  if (status >= 400 && status < 500) return "GitHub rejected the repository list request";
  return "GitHub is unavailable";
}

/**
 * Authenticated GET to api.github.com. Caller must not log the token.
 */
export async function githubApiGet(pathWithQuery: string, token: string): Promise<Response> {
  return fetch(`${GITHUB_API}${pathWithQuery}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ReleaseDesk",
    },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * List repositories the token can see (owner/name). Caps at 200.
 * @throws GithubReposFetchError on non-2xx or timeout.
 */
export async function fetchGithubRepos(token: string): Promise<GithubRepoOption[]> {
  const out: GithubRepoOption[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const path = `/user/repos?per_page=${PAGE_SIZE}&page=${page}&affiliation=owner,collaborator,organization_member&sort=full_name`;
    let body: unknown;
    try {
      const res = await githubApiGet(path, token);
      const text = await res.text();
      if (res.status < 200 || res.status >= 300) {
        throw new GithubReposFetchError(
          publicGithubHttpMessage(res.status),
          res.status >= 400 ? Math.min(res.status, 502) : 502
        );
      }
      body = text ? (JSON.parse(text) as unknown) : [];
    } catch (err) {
      if (err instanceof GithubReposFetchError) throw err;
      throw new GithubReposFetchError("GitHub is unavailable", 502);
    }
    const mapped = mapGithubRepoListPayload(body);
    for (const repo of mapped) {
      if (seen.has(repo.fullName)) continue;
      seen.add(repo.fullName);
      out.push(repo);
    }
    if (mapped.length < PAGE_SIZE) break;
  }
  out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return out;
}
