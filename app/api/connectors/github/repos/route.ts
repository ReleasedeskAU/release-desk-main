import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/api";
import { fetchGithubRepos, GithubReposFetchError } from "@/lib/github/fetch-repos";
import { logger } from "@/lib/logger";
import {
  requiredCredentialField,
  resolveStoredConnector,
  sanitizeListResponse,
  StoredCredentialError,
} from "@/lib/staffless/unmasked-credential";

const pastedSchema = z.object({ token: z.string().trim().min(1).max(500) }).strict();
const storedSchema = z.object({ connectorId: z.string().regex(/^\d+$/) }).strict();
const bodySchema = z.union([storedSchema, pastedSchema]);

const lastCallByTokenHash = new Map<string, number>();
const COOLDOWN_MS = 5_000;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

/**
 * List live GitHub repositories for the wizard. Calls GitHub, not StaffLess.
 * The token is not logged and is not stored.
 */
export async function POST(req: Request) {
  const { error } = await requireRole("editor");
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A GitHub token or a connector id is required" }, { status: 400 });
  }

  let token: string;
  let cooldown: string;
  try {
    if ("connectorId" in parsed.data) {
      const stored = await resolveStoredConnector(parsed.data.connectorId, "github");
      token = requiredCredentialField(stored.credentialJson, "github_access_token");
      cooldown = `connector:${parsed.data.connectorId}`;
    } else {
      token = parsed.data.token;
      cooldown = tokenHash(token);
    }
  } catch (err) {
    if (err instanceof StoredCredentialError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("api/connectors/github/repos", { kind: err instanceof Error ? err.name : "unknown" });
    return NextResponse.json({ error: "Stored credential is unavailable" }, { status: 502 });
  }

  const now = Date.now();
  const last = lastCallByTokenHash.get(cooldown) ?? 0;
  if (now - last < COOLDOWN_MS) {
    return NextResponse.json({ error: "Please wait a few seconds before listing repositories again" }, { status: 429 });
  }
  lastCallByTokenHash.set(cooldown, now);

  try {
    const repos = await fetchGithubRepos(token);
    return NextResponse.json(sanitizeListResponse({ repos }));
  } catch (err) {
    if (err instanceof GithubReposFetchError) {
      logger.warn("api/connectors/github/repos", { status: err.status });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("api/connectors/github/repos", { kind: err instanceof Error ? err.name : "unknown" });
    return NextResponse.json({ error: "GitHub is unavailable" }, { status: 502 });
  }
}
