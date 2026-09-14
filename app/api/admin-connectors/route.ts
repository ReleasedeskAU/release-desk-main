import { NextResponse } from "next/server";
import { CatalogCreateError } from "@/lib/admin-connectors/plan-create";
import { requireRole } from "@/lib/auth/api";
import { BitbucketProbeError } from "@/lib/bitbucket/probe";
import { createCatalogStafflessConnector } from "@/lib/staffless/api";
import { stafflessHttpStatus, stafflessPublicMessage } from "@/lib/staffless/client";
import { logger } from "@/lib/logger";

/**
 * Create an index-engine connector from the Admin Connectors catalog.
 */
export async function POST(req: Request) {
  const { error } = await requireRole("editor");
  if (error) return error;

  const body = (await req.json()) as {
    source?: string;
    name?: string;
    credentials?: Record<string, unknown>;
    config?: Record<string, unknown>;
    pollInterval?: number;
    indexingStart?: string | null;
  };

  try {
    const created = await createCatalogStafflessConnector({
      source: body.source ?? "",
      name: body.name ?? "",
      credentials: body.credentials,
      config: body.config,
      pollInterval: body.pollInterval,
      indexingStart: body.indexingStart,
    });
    return NextResponse.json({ id: String(created.id), name: body.name?.trim(), source: body.source }, { status: 201 });
  } catch (err) {
    if (err instanceof CatalogCreateError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof BitbucketProbeError) {
      return NextResponse.json({ error: err.message }, { status: err.status >= 400 ? Math.min(err.status, 502) : 502 });
    }
    logger.error("api/admin-connectors.POST", { kind: err instanceof Error ? err.name : "unknown" });
    return NextResponse.json(
      { error: stafflessPublicMessage(err) },
      { status: stafflessHttpStatus(err) }
    );
  }
}
