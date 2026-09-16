/**
 * Live Slack bot-token check for Add Connector. Do not log the token.
 */

const TIMEOUT_MS = 15_000;
export const SLACK_TOKEN_MAX_CHARS = 500;
export const SLACK_API = "https://slack.com/api";

export const SLACK_TOKEN_REQUIRED = "Enter a Slack bot token.";
export const SLACK_BOT_TOKEN_REQUIRED =
  "Use a Slack bot token (starts with xoxb-), not a user or app-level token.";
export const SLACK_INVALID_TOKEN = "Slack rejected that token. It is invalid or has been revoked.";
export const SLACK_MISSING_CHANNELS_READ =
  "This Slack token cannot list channels. Grant channels:read (and groups:read for private channels the bot is in).";
export const SLACK_MISSING_HISTORY =
  "This Slack token cannot read messages. Grant channels:history (and groups:history for private channels), then reinstall the app to the workspace.";

export class SlackProbeError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SlackProbeError";
    this.status = status;
  }
}

/**
 * True for a Slack bot token shape. Does not prove Slack accepted it.
 */
export function looksLikeSlackBotToken(token: string): boolean {
  return token.trim().startsWith("xoxb-");
}

function slackErrorSlug(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const error = (body as { error?: unknown }).error;
  return typeof error === "string" ? error : "";
}

/**
 * Map Slack auth slugs to a public message. Does not include response bodies.
 */
export function publicSlackAuthMessage(slug: string, httpStatus: number): string {
  if (slug === "missing_scope") return SLACK_MISSING_CHANNELS_READ;
  if (
    slug === "invalid_auth" ||
    slug === "not_authed" ||
    slug === "token_revoked" ||
    slug === "account_inactive" ||
    slug === "token_expired" ||
    httpStatus === 401
  ) {
    return SLACK_INVALID_TOKEN;
  }
  if (httpStatus === 403 || slug === "access_denied") return SLACK_MISSING_CHANNELS_READ;
  if (httpStatus >= 400 && httpStatus < 500) return "Slack rejected the request.";
  return "Slack is unavailable";
}

/**
 * POST to api.slack.com. Caller must not log the token.
 */
export async function slackApiPost(method: string, token: string, query = ""): Promise<{ status: number; body: unknown }> {
  const url = `${SLACK_API}/${method}${query ? `?${query}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text().catch(() => "");
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = {};
    }
  }
  return { status: res.status, body };
}

/**
 * Confirm Slack accepts this bot token. Uses auth.test (requires auth).
 * @throws SlackProbeError when the token is missing, not a bot token, or Slack rejects it.
 */
export async function assertSlackTokenReachable(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new SlackProbeError(SLACK_TOKEN_REQUIRED, 400);
  if (!looksLikeSlackBotToken(trimmed)) throw new SlackProbeError(SLACK_BOT_TOKEN_REQUIRED, 400);
  if (trimmed.length > SLACK_TOKEN_MAX_CHARS) {
    throw new SlackProbeError(SLACK_INVALID_TOKEN, 401);
  }
  try {
    const { status, body } = await slackApiPost("auth.test", trimmed);
    const record = body && typeof body === "object" && !Array.isArray(body) ? (body as { ok?: unknown }) : {};
    if (status === 200 && record.ok === true) return;
    const slug = slackErrorSlug(body);
    const mapped = status === 200 && slug ? 401 : status;
    throw new SlackProbeError(
      publicSlackAuthMessage(slug, mapped),
      mapped >= 400 ? Math.min(mapped, 502) : 502
    );
  } catch (err) {
    if (err instanceof SlackProbeError) throw err;
    throw new SlackProbeError("Slack is unavailable", 502);
  }
}
