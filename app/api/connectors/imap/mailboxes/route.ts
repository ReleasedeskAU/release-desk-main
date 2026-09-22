import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/api";
import { fetchImapFolders, ImapFoldersFetchError } from "@/lib/imap/fetch-mailboxes";
import { ImapHostError } from "@/lib/imap/host";
import { logger } from "@/lib/logger";
import {
  requiredCredentialField,
  resolveStoredConnector,
  sanitizeListResponse,
  StoredCredentialError,
} from "@/lib/staffless/unmasked-credential";

const pastedSchema = z
  .object({
    host: z.string().trim().min(1).max(253),
    port: z.number().int().min(1).max(65535).optional(),
    username: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(500),
  })
  .strict();
const storedSchema = z.object({ connectorId: z.string().regex(/^\d+$/) }).strict();
const bodySchema = z.union([storedSchema, pastedSchema]);

const lastCallByKey = new Map<string, number>();
const COOLDOWN_MS = 5_000;

function cooldownKey(username: string, host: string): string {
  return createHash("sha256").update(`${username}\0${host}`).digest("hex").slice(0, 16);
}

/**
 * List live IMAP folders for the wizard. Calls the IMAP host, not StaffLess.
 * Username and password are not logged and are not stored.
 */
export async function POST(req: Request) {
  const { error } = await requireRole("editor");
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "IMAP host, username, and password, or a connector id, are required" }, { status: 400 });
  }

  let host: string;
  let port: number;
  let username: string;
  let password: string;
  let cooldown: string;
  try {
    if ("connectorId" in parsed.data) {
      const stored = await resolveStoredConnector(parsed.data.connectorId, "imap");
      username = requiredCredentialField(stored.credentialJson, "imap_username");
      password = requiredCredentialField(stored.credentialJson, "imap_password");
      host = typeof stored.config.host === "string" ? stored.config.host.trim() : "";
      const portRaw = stored.config.port;
      port = typeof portRaw === "number" ? portRaw : Number(portRaw) || 993;
      if (!host) throw new StoredCredentialError("Stored credential is unavailable", 502);
      cooldown = `connector:${parsed.data.connectorId}`;
    } else {
      host = parsed.data.host;
      port = parsed.data.port ?? 993;
      username = parsed.data.username;
      password = parsed.data.password;
      cooldown = cooldownKey(username, host);
    }
  } catch (err) {
    if (err instanceof StoredCredentialError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("api/connectors/imap/mailboxes", { kind: err instanceof Error ? err.name : "unknown" });
    return NextResponse.json({ error: "Stored credential is unavailable" }, { status: 502 });
  }

  const now = Date.now();
  const last = lastCallByKey.get(cooldown) ?? 0;
  if (now - last < COOLDOWN_MS) {
    return NextResponse.json({ error: "Please wait a few seconds before listing folders again" }, { status: 429 });
  }
  lastCallByKey.set(cooldown, now);

  try {
    const folders = await fetchImapFolders(host, port, username, password);
    return NextResponse.json(sanitizeListResponse({ folders }));
  } catch (err) {
    if (err instanceof ImapHostError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof ImapFoldersFetchError) {
      logger.warn("api/connectors/imap/mailboxes", { status: err.status });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("api/connectors/imap/mailboxes", { kind: err instanceof Error ? err.name : "unknown" });
    return NextResponse.json({ error: "IMAP is unavailable" }, { status: 502 });
  }
}
