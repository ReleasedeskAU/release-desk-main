import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/api";
import { fetchSlackChannels } from "@/lib/slack/fetch-channels";
import { SlackProbeError } from "@/lib/slack/probe";
import { logger } from "@/lib/logger";

const bodySchema = z.object({ token: z.string().trim().min(1).max(500) }).strict();

const lastCallByTokenHash = new Map<string, number>();
const COOLDOWN_MS = 5_000;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

/**
 * List live Slack channels for the wizard. Calls Slack, not StaffLess.
 * The token is not logged and is not stored.
 */
export async function POST(req: Request) {
  const { error } = await requireRole("editor");
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Slack bot token is required" }, { status: 400 });
  }

  const now = Date.now();
  const key = tokenHash(parsed.data.token);
  const last = lastCallByTokenHash.get(key) ?? 0;
  if (now - last < COOLDOWN_MS) {
    return NextResponse.json({ error: "Please wait a few seconds before listing channels again" }, { status: 429 });
  }
  lastCallByTokenHash.set(key, now);

  try {
    const channels = await fetchSlackChannels(parsed.data.token);
    return NextResponse.json({ channels });
  } catch (err) {
    if (err instanceof SlackProbeError) {
      logger.warn("api/connectors/slack/channels", { status: err.status });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("api/connectors/slack/channels", { kind: err instanceof Error ? err.name : "unknown" });
    return NextResponse.json({ error: "Slack is unavailable" }, { status: 502 });
  }
}
