/**
 * Live Jira credential check for Add Connector. Do not log the token or email.
 * Project list is not used: some sites return 200 for anonymous /project/search.
 */

import { looksLikeAtlassianEmail } from "@/lib/connectors/atlassian-email";
import { JiraProjectsFetchError } from "@/lib/jira/fetch-projects";
import { JiraSiteError, parsePublicJiraOrigin } from "@/lib/jira/site";

export { looksLikeAtlassianEmail };

const TIMEOUT_MS = 15_000;
export const JIRA_TOKEN_MAX_CHARS = 500;

export const JIRA_URL_REQUIRED = "Enter your Jira site URL, like https://your-org.atlassian.net";
export const JIRA_EMAIL_REQUIRED =
  "Enter the Atlassian account email that created this API token.";
export const JIRA_TOKEN_REQUIRED = "Enter a Jira API token.";
export const JIRA_INVALID_TOKEN =
  "Jira rejected those credentials. Use the Atlassian account email that created this API token, and check the token and site URL.";
export const JIRA_UNREACHABLE_URL =
  "Could not reach that Jira site URL. Check the URL (https://your-org.atlassian.net).";
export const JIRA_SITE_NOT_FOUND =
  "That URL is not a Jira site, or the site was not found. Use https://your-org.atlassian.net with no extra path.";
export const JIRA_SITE_FORBIDDEN = "This Jira token cannot access that site.";

function mapJiraProbeFailure(err: unknown): never {
  if (err instanceof JiraProjectsFetchError) throw err;
  if (err instanceof JiraSiteError) throw new JiraProjectsFetchError(err.message, err.status);
  throw new JiraProjectsFetchError(JIRA_UNREACHABLE_URL, 502);
}

/**
 * Confirm Jira accepts this email + API token. Uses GET /myself (requires auth).
 *
 * @throws JiraProjectsFetchError when the URL/email/token is invalid or Jira rejects them.
 */
export async function assertJiraTokenReachable(
  baseUrl: string,
  email: string,
  apiToken: string
): Promise<void> {
  const trimmedEmail = email.trim();
  const trimmedToken = apiToken.trim();
  if (!baseUrl.trim()) {
    throw new JiraProjectsFetchError(JIRA_URL_REQUIRED, 400);
  }
  if (!trimmedEmail || !looksLikeAtlassianEmail(trimmedEmail)) {
    throw new JiraProjectsFetchError(JIRA_EMAIL_REQUIRED, 400);
  }
  if (!trimmedToken) {
    throw new JiraProjectsFetchError(JIRA_TOKEN_REQUIRED, 400);
  }
  if (trimmedToken.length > JIRA_TOKEN_MAX_CHARS) {
    throw new JiraProjectsFetchError(JIRA_INVALID_TOKEN, 401);
  }

  let origin: string;
  try {
    origin = parsePublicJiraOrigin(baseUrl);
  } catch (err) {
    mapJiraProbeFailure(err);
  }

  const auth = Buffer.from(`${trimmedEmail}:${trimmedToken}`, "utf8").toString("base64");
  try {
    const res = await fetch(`${origin}/rest/api/3/myself`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.text().catch(() => "");
    if (res.status === 401) {
      throw new JiraProjectsFetchError(JIRA_INVALID_TOKEN, 401);
    }
    if (res.status === 403) {
      throw new JiraProjectsFetchError(JIRA_SITE_FORBIDDEN, 403);
    }
    if (res.status === 404) {
      throw new JiraProjectsFetchError(JIRA_SITE_NOT_FOUND, 404);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new JiraProjectsFetchError(
        res.status >= 400 && res.status < 500 ? JIRA_INVALID_TOKEN : "Jira is unavailable",
        res.status >= 400 ? Math.min(res.status, 502) : 502
      );
    }
  } catch (err) {
    mapJiraProbeFailure(err);
  }
}
