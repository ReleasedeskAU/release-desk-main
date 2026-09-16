/**
 * Live Slack channel list for Add Connector. Do not log the token.
 * Lists channels the bot is already in. Does not join channels.
 */

import {
  SLACK_INVALID_TOKEN,
  SLACK_MISSING_CHANNELS_READ,
  SLACK_MISSING_HISTORY,
  SLACK_TOKEN_REQUIRED,
  SlackProbeError,
  looksLikeSlackBotToken,
  publicSlackAuthMessage,
  slackApiPost,
} from "@/lib/slack/probe";

const PAGE_SIZE = 100;
const MAX_PAGES = 2;

export type SlackChannelOption = {
  fullName: string;
  name: string;
  owner: string;
  private?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function nextCursor(body: unknown): string {
  const rec = asRecord(body);
  const meta = asRecord(rec?.response_metadata);
  const cursor = typeof meta?.next_cursor === "string" ? meta.next_cursor.trim() : "";
  return cursor;
}

/**
 * Picker rows for channel names already saved on a connector.
 * Edit can show the selection without pasting the bot token again.
 */
export function savedSlackChannelOptions(names: string[]): SlackChannelOption[] {
  return parseSlackChannelNames(names).map((name) => ({
    fullName: name,
    name: `#${name}`,
    owner: "saved",
  }));
}

function slackOk(body: unknown): boolean {
  return asRecord(body)?.ok === true;
}

function slackSlug(body: unknown): string {
  const error = asRecord(body)?.error;
  return typeof error === "string" ? error : "";
}

/**
 * Map one Slack users.conversations row. DMs and explicit non-members are dropped.
 * Slack often omits is_member on this endpoint — membership is implied, so omit is kept.
 */
export function mapSlackChannel(raw: unknown): SlackChannelOption | null {
  const row = asRecord(raw);
  if (!row) return null;
  if (row.is_im === true || row.is_mpim === true) return null;
  if (row.is_archived === true) return null;
  if (row.is_member === false) return null;
  const name = typeof row.name === "string" ? row.name.trim().replace(/^#/, "") : "";
  if (!name) return null;
  const isPrivate = row.is_private === true;
  return {
    fullName: name,
    name: `#${name}`,
    owner: isPrivate ? "private" : "public",
    private: isPrivate,
  };
}

/**
 * First comma/newline channel slug, with a leading # removed.
 */
export function parseSlackChannelNames(raw: unknown): string[] {
  const parts: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && item.trim()) parts.push(item);
    }
  } else if (typeof raw === "string" && raw.trim()) {
    parts.push(...raw.split(/[\n,]+/));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const name = part.trim().replace(/^#/, "");
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

async function listChannelPage(token: string, types: string, cursor: string): Promise<{ body: unknown; status: number }> {
  const params = new URLSearchParams({
    types,
    exclude_archived: "true",
    limit: String(PAGE_SIZE),
  });
  if (cursor) params.set("cursor", cursor);
  return slackApiPost("users.conversations", token, params.toString());
}

/**
 * Confirm the bot can read message text (channels:history). Listing channels does not prove that.
 * not_in_channel on the probe channel is ignored — membership can lag Slack's list.
 * @throws SlackProbeError when the token is missing history scopes or is invalid.
 */
async function assertSlackCanReadHistory(token: string, channelId: string): Promise<void> {
  const params = new URLSearchParams({ channel: channelId, limit: "1" });
  const { status, body } = await slackApiPost("conversations.history", token, params.toString());
  if (status === 200 && slackOk(body)) return;
  const slug = slackSlug(body);
  if (slug === "not_in_channel" || slug === "channel_not_found" || slug === "is_archived") return;
  const mapped = status === 200 && slug ? 401 : status;
  if (slug === "missing_scope" || mapped === 403) {
    throw new SlackProbeError(SLACK_MISSING_HISTORY, 403);
  }
  throw new SlackProbeError(
    publicSlackAuthMessage(slug, mapped) === SLACK_INVALID_TOKEN ? SLACK_INVALID_TOKEN : SLACK_MISSING_HISTORY,
    mapped >= 400 ? Math.min(mapped, 502) : 502
  );
}

/**
 * Channels the bot is a member of (public + private). Caps at 200. Never joins.
 * Uses users.conversations so Slack does not return workspace channels the bot is not in.
 * @throws SlackProbeError on auth or list failure.
 */
export async function fetchSlackChannels(token: string): Promise<SlackChannelOption[]> {
  const trimmed = token.trim();
  if (!trimmed) throw new SlackProbeError(SLACK_TOKEN_REQUIRED, 400);
  if (!looksLikeSlackBotToken(trimmed)) {
    throw new SlackProbeError(
      "Use a Slack bot token (starts with xoxb-), not a user or app-level token.",
      400
    );
  }
  let types = "public_channel,private_channel";
  const out: SlackChannelOption[] = [];
  const seen = new Set<string>();
  let cursor = "";
  let publicProbeId = "";
  let anyProbeId = "";
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { status, body } = await listChannelPage(trimmed, types, cursor);
      if (status !== 200 || !slackOk(body)) {
        const slug = slackSlug(body);
        if (types.includes("private_channel") && (slug === "missing_scope" || status === 403)) {
          types = "public_channel";
          cursor = "";
          page = -1;
          continue;
        }
        const mapped = status === 200 && slug ? 401 : status;
        const message =
          slug === "missing_scope"
            ? SLACK_MISSING_CHANNELS_READ
            : publicSlackAuthMessage(slug, mapped) === SLACK_INVALID_TOKEN
              ? SLACK_INVALID_TOKEN
              : "Slack could not list channels for this token.";
        throw new SlackProbeError(message, mapped >= 400 ? Math.min(mapped, 502) : 502);
      }
      const channels = asRecord(body)?.channels;
      const rows = Array.isArray(channels) ? channels : [];
      for (const item of rows) {
        const mapped = mapSlackChannel(item);
        if (!mapped || seen.has(mapped.fullName)) continue;
        seen.add(mapped.fullName);
        out.push(mapped);
        const row = asRecord(item);
        const id = typeof row?.id === "string" ? row.id.trim() : "";
        if (!id) continue;
        if (!anyProbeId) anyProbeId = id;
        if (!publicProbeId && mapped.private !== true) publicProbeId = id;
      }
      cursor = nextCursor(body);
      if (!cursor) break;
    }
    const probeId = publicProbeId || anyProbeId;
    if (probeId) await assertSlackCanReadHistory(trimmed, probeId);
  } catch (err) {
    if (err instanceof SlackProbeError) throw err;
    throw new SlackProbeError("Slack is unavailable", 502);
  }
  out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return out;
}
