import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/api";
import { logger } from "@/lib/logger";
import { fetchTeams, TeamsListError } from "@/lib/teams/fetch-teams";
import {
  requiredCredentialField,
  resolveStoredConnector,
  sanitizeListResponse,
  StoredCredentialError,
} from "@/lib/staffless/unmasked-credential";

const pastedSchema = z
  .object({
    clientId: z.string().trim().min(1).max(80),
    clientSecret: z.string().min(1).max(500),
    directoryId: z.string().trim().min(1).max(80),
  })
  .strict();
const storedSchema = z.object({ connectorId: z.string().regex(/^\d+$/) }).strict();
const bodySchema = z.union([storedSchema, pastedSchema]);

const lastCallByKey = new Map<string, number>();
const COOLDOWN_MS = 5_000;

function secretHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

/**
 * List live Microsoft Teams for the wizard. Calls Graph, not StaffLess.
 * The client secret is not logged and is not stored. Editor role required.
 */
export async function POST(req: Request) {
  const { error } = await requireRole("editor");
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Teams app credentials or a connector id is required" }, { status: 400 });
  }

  let clientId: string;
  let clientSecret: string;
  let directoryId: string;
  let cooldown: string;
  try {
    if ("connectorId" in parsed.data) {
      const stored = await resolveStoredConnector(parsed.data.connectorId, "teams");
      clientId = requiredCredentialField(stored.credentialJson, "teams_client_id");
      clientSecret = requiredCredentialField(stored.credentialJson, "teams_client_secret");
      directoryId = requiredCredentialField(stored.credentialJson, "teams_directory_id");
      cooldown = `connector:${parsed.data.connectorId}`;
    } else {
      clientId = parsed.data.clientId;
      clientSecret = parsed.data.clientSecret;
      directoryId = parsed.data.directoryId;
      cooldown = secretHash(clientSecret);
    }
  } catch (err) {
    if (err instanceof StoredCredentialError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("api/connectors/teams/teams", { kind: err instanceof Error ? err.name : "unknown" });
    return NextResponse.json({ error: "Stored credential is unavailable" }, { status: 502 });
  }

  const now = Date.now();
  const last = lastCallByKey.get(cooldown) ?? 0;
  if (now - last < COOLDOWN_MS) {
    return NextResponse.json({ error: "Please wait a few seconds before listing teams again" }, { status: 429 });
  }
  lastCallByKey.set(cooldown, now);

  try {
    const teams = await fetchTeams(clientId, clientSecret, directoryId);
    return NextResponse.json(sanitizeListResponse({ teams }));
  } catch (err) {
    if (err instanceof TeamsListError) {
      logger.warn("api/connectors/teams/teams", { status: err.status });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("api/connectors/teams/teams", { kind: err instanceof Error ? err.name : "unknown" });
    return NextResponse.json({ error: "Microsoft Graph is unavailable" }, { status: 502 });
  }
}
