/**
 * Reject private/non-HTTPS Jira sites so the project-list call cannot be used as SSRF.
 */

export class JiraSiteError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "JiraSiteError";
    this.status = status;
  }
}

/**
 * Parse and allow only https Jira hostnames (no credentials in the URL, no IP literals).
 * @throws JiraSiteError when the URL is not a public HTTPS origin.
 */
export function parsePublicJiraOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new JiraSiteError("Enter your Jira site URL, like https://your-org.atlassian.net");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new JiraSiteError("Enter a valid Jira site URL, like https://your-org.atlassian.net");
  }
  if (url.protocol !== "https:") {
    throw new JiraSiteError("Jira site URL must use https");
  }
  if (url.username || url.password) {
    throw new JiraSiteError("Jira site URL cannot include a username or password");
  }
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new JiraSiteError("Jira site URL is not allowed");
  }
  // Block IP literals so this path cannot be pointed at an internal address.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    throw new JiraSiteError("Jira site URL is not allowed");
  }
  return `${url.protocol}//${host}${url.port && url.port !== "443" ? `:${url.port}` : ""}`;
}
