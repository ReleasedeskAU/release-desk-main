import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/api";
import { CatalogCreateError } from "@/lib/admin-connectors/plan-create";
import { fetchBitbucketRepos } from "@/lib/bitbucket/fetch-repos";
import { BitbucketProbeError, firstBitbucketSlug } from "@/lib/bitbucket/probe";
import { logger } from "@/lib/logger";

const bodySchema = z
  .object({
    email: z.string().trim().min(1).max(320),
    token: z.string().trim().min(1).max(500),
    workspace: z.string().trim().min(1).max(80),
  })
  .strict();

const lastCallByTokenHash = new Map<string, number>();
const COOLDOWN_MS = 5_000;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

/**
 * List live Bitbucket repositories for the wizard. Calls Bitbucket, not StaffLess.
 * The token is not logged and is not stored.
 */
export async function POST(req: Request) {
  const { error } = await requireRole("editor");
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bitbucket email, API token, and workspace slug are required" },
      { status: 400 }
    );
  }

  const now = Date.now();
  const key = tokenHash(parsed.data.token);
  const last = lastCallByTokenHash.get(key) ?? 0;
  if (now - last < COOLDOWN_MS) {
    return NextResponse.json({ error: "Please wait a few seconds before listing repositories again" }, { status: 429 });
  }
  lastCallByTokenHash.set(key, now);

  try {
    const workspace = firstBitbucketSlug(parsed.data.workspace, "Workspace", true);
    const repos = await fetchBitbucketRepos(parsed.data.email, parsed.data.token, workspace);
    return NextResponse.json({ repos });
  } catch (err) {
    if (err instanceof CatalogCreateError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof BitbucketProbeError) {
      logger.warn("api/connectors/bitbucket/repos", { status: err.status });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("api/connectors/bitbucket/repos", { kind: err instanceof Error ? err.name : "unknown" });
    return NextResponse.json({ error: "Bitbucket is unavailable" }, { status: 502 });
  }
}
