import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/api";
import { fetchGitlabProjects } from "@/lib/gitlab/fetch-projects";
import { GitlabProbeError } from "@/lib/gitlab/probe";
import { GitlabSiteError } from "@/lib/gitlab/site";
import { logger } from "@/lib/logger";

const bodySchema = z
  .object({
    baseUrl: z.string().trim().min(1).max(500),
    token: z.string().trim().min(1).max(500),
  })
  .strict();

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
    return NextResponse.json({ error: "GitLab URL and access token are required" }, { status: 400 });
  }

  const now = Date.now();
  const key = tokenHash(parsed.data.token);
  const last = lastCallByTokenHash.get(key) ?? 0;
  if (now - last < COOLDOWN_MS) {
    return NextResponse.json({ error: "Please wait a few seconds before listing projects again" }, { status: 429 });
  }
  lastCallByTokenHash.set(key, now);

  try {
    const projects = await fetchGitlabProjects(parsed.data.baseUrl, parsed.data.token);
    return NextResponse.json({ projects });
  } catch (err) {
    if (err instanceof GitlabProbeError || err instanceof GitlabSiteError) {
      logger.warn("api/connectors/gitlab/projects", { status: err.status });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("api/connectors/gitlab/projects", { kind: err instanceof Error ? err.name : "unknown" });
    return NextResponse.json({ error: "GitLab is unavailable" }, { status: 502 });
  }
}
