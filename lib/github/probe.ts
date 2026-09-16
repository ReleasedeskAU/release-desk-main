/**
 * Live GitHub PAT check for Add Connector. Do not log the token.
 */

import {
  GITHUB_TOKEN_MAX_CHARS,
  GithubReposFetchError,
  githubApiGet,
  publicGithubHttpMessage,
} from "@/lib/github/fetch-repos";

const CLASSIC_REPO_SCOPES = new Set(["repo", "public_repo"]);

export const GITHUB_MISSING_REPO_SCOPE =
  "This GitHub token is valid but is missing required scope: repo (or public_repo for public repositories only).";

export const GITHUB_MISSING_CONTENTS_READ =
  "This GitHub token is valid but is missing required permission: Contents (read). Grant Contents: Read on a fine-grained token, or the repo (or public_repo) scope on a classic token.";

/** GitHub's contents API message when the repo exists but has no files. */
const EMPTY_REPO_CONTENTS_MESSAGE = "this repository is empty.";

/**
 * True only for an empty repository. Fine-grained tokens without Contents: Read
 * also 404 ("Not Found") — that is missing permission, not an empty repo.
 *
 * @param body - Raw GitHub JSON body. Never log this.
 * @returns True when the message is GitHub's empty-repository text.
 */
export function githubContents404IsEmptyRepo(body: string): boolean {
  if (!body) return false;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const message = (parsed as { message?: unknown }).message;
    return typeof message === "string" && message.trim().toLowerCase() === EMPTY_REPO_CONTENTS_MESSAGE;
  } catch {
    return false;
  }
}

/**
 * Confirm GitHub accepts this token and that it can read repositories.
 * 401 = invalid or revoked. Empty classic scopes / no Contents: Read = 403.
 *
 * @throws GithubReposFetchError when GitHub rejects the token or it lacks repo read.
 */
export async function assertGithubTokenReachable(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new GithubReposFetchError("A GitHub personal access token is required", 400);
  }
  if (trimmed.length > GITHUB_TOKEN_MAX_CHARS) {
    throw new GithubReposFetchError(publicGithubHttpMessage(401), 401);
  }
  try {
    const res = await githubApiGet("/user/repos?per_page=1", trimmed);
    const text = await res.text().catch(() => "");
    if (res.status < 200 || res.status >= 300) {
      throw new GithubReposFetchError(
        publicGithubHttpMessage(res.status),
        res.status >= 400 ? Math.min(res.status, 502) : 502
      );
    }
    await assertRepoReadPermission(trimmed, res, text);
  } catch (err) {
    if (err instanceof GithubReposFetchError) throw err;
    throw new GithubReposFetchError("GitHub is unavailable", 502);
  }
}

/** Parse classic PAT scopes from X-OAuth-Scopes. Empty header → []. */
export function parseGithubOAuthScopes(header: string | null): string[] {
  if (header == null) return [];
  return header
    .split(/[,\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

/** True when classic scopes include repository read. */
export function classicScopesIncludeRepoRead(scopes: string[]): boolean {
  return scopes.some((scope) => CLASSIC_REPO_SCOPES.has(scope));
}

/** True when X-Accepted-GitHub-Permissions includes contents=read. */
export function acceptedPermissionsIncludeContentsRead(header: string | null): boolean {
  if (!header) return false;
  return header
    .split(";")
    .map((part) => part.trim().toLowerCase())
    .some((part) => part === "contents=read" || part.startsWith("contents=read,"));
}

function headerValue(res: Response, name: string): string | null {
  const value = res.headers.get(name);
  return value == null || value === "" ? null : value;
}

function hasOAuthScopesHeader(res: Response): boolean {
  return res.headers.has("X-OAuth-Scopes") || res.headers.has("x-oauth-scopes");
}

async function assertRepoReadPermission(token: string, listRes: Response, listBody: string): Promise<void> {
  const oauthHeader = headerValue(listRes, "X-OAuth-Scopes");
  const scopes = parseGithubOAuthScopes(oauthHeader ?? (hasOAuthScopesHeader(listRes) ? "" : null));
  const classic = token.startsWith("ghp_") || hasOAuthScopesHeader(listRes);

  if (classic) {
    if (classicScopesIncludeRepoRead(scopes)) return;
    throw new GithubReposFetchError(GITHUB_MISSING_REPO_SCOPE, 403);
  }

  const accepted = headerValue(listRes, "X-Accepted-GitHub-Permissions");
  if (acceptedPermissionsIncludeContentsRead(accepted)) return;

  const fullName = firstRepoFullName(listBody);
  if (!fullName) {
    throw new GithubReposFetchError(GITHUB_MISSING_CONTENTS_READ, 403);
  }
  await assertContentsReadOnRepo(token, fullName);
}

async function assertContentsReadOnRepo(token: string, fullName: string): Promise<void> {
  const slash = fullName.indexOf("/");
  const owner = slash === -1 ? "" : fullName.slice(0, slash);
  const name = slash === -1 ? "" : fullName.slice(slash + 1);
  if (!owner || !name) {
    throw new GithubReposFetchError(GITHUB_MISSING_CONTENTS_READ, 403);
  }
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/`;
  const res = await githubApiGet(path, token);
  const text = await res.text().catch(() => "");
  if (res.status === 404) {
    // GitHub uses 404 for both an empty repo and a token that cannot read contents.
    if (githubContents404IsEmptyRepo(text)) return;
    throw new GithubReposFetchError(GITHUB_MISSING_CONTENTS_READ, 403);
  }
  const accepted = headerValue(res, "X-Accepted-GitHub-Permissions");
  if (res.status === 403 || !acceptedPermissionsIncludeContentsRead(accepted)) {
    throw new GithubReposFetchError(GITHUB_MISSING_CONTENTS_READ, 403);
  }
}

function firstRepoFullName(body: string): string | null {
  if (!body) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const row = parsed[0];
  if (!row || typeof row !== "object") return null;
  const fullName = (row as { full_name?: unknown }).full_name;
  return typeof fullName === "string" && fullName.includes("/") ? fullName : null;
}
