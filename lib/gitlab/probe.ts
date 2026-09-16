/**
 * Live GitLab token check for Add Connector. Do not log the token.
 */

import { GitlabSiteError, parsePublicGitlabOrigin } from "@/lib/gitlab/site";

const TIMEOUT_MS = 15_000;
export const GITLAB_TOKEN_MAX_CHARS = 500;

export const GITLAB_URL_REQUIRED = "Enter your GitLab URL, like https://gitlab.com";
export const GITLAB_TOKEN_REQUIRED = "Enter a GitLab personal access token.";
export const GITLAB_INVALID_TOKEN =
  "GitLab rejected that token. It is invalid or has been revoked.";
export const GITLAB_MISSING_API =
  "This GitLab token is valid but cannot read projects. Grant read_api (or api) on the token.";
export const GITLAB_UNREACHABLE_URL =
  "Could not reach that GitLab URL. Check the URL (https://gitlab.com).";

export class GitlabProbeError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GitlabProbeError";
    this.status = status;
  }
}

function mapGitlabFailure(err: unknown): never {
  if (err instanceof GitlabProbeError) throw err;
  if (err instanceof GitlabSiteError) throw new GitlabProbeError(err.message, err.status);
  throw new GitlabProbeError(GITLAB_UNREACHABLE_URL, 502);
}

/**
 * Confirm GitLab accepts this token. Uses GET /api/v4/user (requires auth).
 *
 * @throws GitlabProbeError when the URL/token is invalid or GitLab rejects them.
 */
export async function assertGitlabTokenReachable(baseUrl: string, token: string): Promise<void> {
  const trimmed = token.trim();
  if (!baseUrl.trim()) throw new GitlabProbeError(GITLAB_URL_REQUIRED, 400);
  if (!trimmed) throw new GitlabProbeError(GITLAB_TOKEN_REQUIRED, 400);
  if (trimmed.length > GITLAB_TOKEN_MAX_CHARS) {
    throw new GitlabProbeError(GITLAB_INVALID_TOKEN, 401);
  }

  let origin: string;
  try {
    origin = parsePublicGitlabOrigin(baseUrl);
  } catch (err) {
    mapGitlabFailure(err);
  }

  try {
    const res = await fetch(`${origin}/api/v4/user`, {
      method: "GET",
      headers: {
        "PRIVATE-TOKEN": trimmed,
        Accept: "application/json",
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.text().catch(() => "");
    if (res.status === 401) throw new GitlabProbeError(GITLAB_INVALID_TOKEN, 401);
    if (res.status === 403) throw new GitlabProbeError(GITLAB_MISSING_API, 403);
    if (res.status < 200 || res.status >= 300) {
      throw new GitlabProbeError(
        res.status === 404 ? GITLAB_UNREACHABLE_URL : GITLAB_INVALID_TOKEN,
        res.status >= 400 ? Math.min(res.status, 502) : 502
      );
    }
  } catch (err) {
    mapGitlabFailure(err);
  }
}
