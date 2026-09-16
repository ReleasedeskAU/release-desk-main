/**
 * Reject private/non-HTTPS GitLab sites so the project-list call cannot be used as SSRF.
 */

export class GitlabSiteError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "GitlabSiteError";
    this.status = status;
  }
}

/**
 * Parse and allow only https GitLab hostnames (no credentials in the URL, no IP literals).
 * @throws GitlabSiteError when the URL is not a public HTTPS origin.
 */
export function parsePublicGitlabOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new GitlabSiteError("Enter your GitLab URL, like https://gitlab.com");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new GitlabSiteError("Enter a valid GitLab URL, like https://gitlab.com");
  }
  if (url.protocol !== "https:") {
    throw new GitlabSiteError("GitLab URL must use https");
  }
  if (url.username || url.password) {
    throw new GitlabSiteError("GitLab URL cannot include a username or password");
  }
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new GitlabSiteError("GitLab URL is not allowed");
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    throw new GitlabSiteError("GitLab URL is not allowed");
  }
  return `${url.protocol}//${host}${url.port && url.port !== "443" ? `:${url.port}` : ""}`;
}
