import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/api";
import { fetchGitlabProjects } from "@/lib/gitlab/fetch-projects";
import { GitlabProbeError } from "@/lib/gitlab/probe";
import { GitlabSiteError } from "@/lib/gitlab/site";
import { logger } from "@/lib/logger";
import {
  requiredCredentialField,
  resolveStoredConnector,
  sanitizeListResponse,
  StoredCredentialError,
} from "@/lib/staffless/unmasked-credential";

const pastedSchema = z
  .object({
    baseUrl: z.string().trim().min(1).max(500),
    token: z.string().trim().min(1).max(500),
  })
  .strict();
const storedSchema = z.object({ connectorId: z.string().regex(/^\d+$/) }).strict();
const bodySchema = z.union([storedSchema, pastedSchema]);

const lastCallByTokenHash = new Map<string, number>();
const COOLDOWN_MS = 5_000;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

/**
 * List live GitLab projects for the wizard. Calls GitLab, not StaffLess.
 * The token is not logged and is not stored.
 */
export async function POST(req: Request) {
  const { error } = await requireRole("editor");
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "GitLab URL and access token, or a connector id, are required" }, { status: 400 });
  }

  let baseUrl: string;
  let token: string;
  let cooldown: string;
  try {
    if ("connectorId" in parsed.data) {
      const stored = await resolveStoredConnector(parsed.data.connectorId, "gitlab");
      token = requiredCredentialField(stored.credentialJson, "gitlab_access_token");
      baseUrl = stored.credentialJson.gitlab_url?.trim() || stored.baseUrl?.trim() || "";
      if (!baseUrl) throw new StoredCredentialError("Stored credential is unavailable", 502);
      cooldown = `connector:${parsed.data.connectorId}`;
    } else {
      baseUrl = parsed.data.baseUrl;
      token = parsed.data.token;
      cooldown = tokenHash(token);
    }
  } catch (err) {
    if (err instanceof StoredCredentialError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("api/connectors/gitlab/projects", { kind: err instanceof Error ? err.name : "unknown" });
    return NextResponse.json({ error: "Stored credential is unavailable" }, { status: 502 });
  }

  const now = Date.now();
  const last = lastCallByTokenHash.get(cooldown) ?? 0;
  if (now - last < COOLDOWN_MS) {
    return NextResponse.json({ error: "Please wait a few seconds before listing projects again" }, { status: 429 });
  }
  lastCallByTokenHash.set(cooldown, now);

  try {
    const projects = await fetchGitlabProjects(baseUrl, token);
    return NextResponse.json(sanitizeListResponse({ projects }));
  } catch (err) {
    if (err instanceof GitlabProbeError || err instanceof GitlabSiteError) {
      logger.warn("api/connectors/gitlab/projects", { status: err.status });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("api/connectors/gitlab/projects", { kind: err instanceof Error ? err.name : "unknown" });
    return NextResponse.json({ error: "GitLab is unavailable" }, { status: 502 });
  }
}
