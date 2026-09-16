import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/api";
import { summarizeWorkItems } from "@/lib/dependency-impact";
import { listStafflessConnectors, searchStafflessWorkItems } from "@/lib/staffless/api";
import { stafflessHttpStatus, stafflessPublicMessage } from "@/lib/staffless/client";
import { logger } from "@/lib/logger";

export const maxDuration = 60;

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;

const querySchema = z
  .object({
    connectorId: z.string().trim().min(1).max(64).optional(),
    source: z.string().trim().min(1).max(64).optional(),
    q: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
    offset: z.coerce.number().int().min(0).max(50_000).optional(),
  })
  .strict();

/**
 * Lists indexed documents from StaffLess AI (POST /admin/search), not Postgres WorkItem.
 */
export async function GET(req: Request) {
  const { error } = await requireRole("readonly");
  if (error) return error;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { connectorId, source, q, limit = DEFAULT_LIMIT, offset = 0 } = parsed.data;

  try {
    const connectors = await listStafflessConnectors();
    const selected = connectorId ? connectors.find((c) => c.id === connectorId) : undefined;
    const sourceFilter = source ?? selected?.type;
    const items = await searchStafflessWorkItems(q ?? "", sourceFilter);
    const page = items.slice(offset, offset + limit);
    const lastSynced =
      connectors
        .map((c) => c.lastSyncedAt)
        .filter((v): v is string => Boolean(v))
        .sort()
        .at(-1) ?? null;

    return NextResponse.json({
      items: page,
      total: items.length,
      limit,
      offset,
      summary: summarizeWorkItems(page),
      lastSynced,
      connectors: connectors.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        lastSyncedAt: c.lastSyncedAt,
      })),
    });
  } catch (err) {
    logger.error("api/work-items", {
      kind: err instanceof Error ? err.name : "unknown",
      message: err instanceof Error ? err.message : undefined,
    });
    return NextResponse.json(
      { error: stafflessPublicMessage(err) },
      { status: stafflessHttpStatus(err) }
    );
  }
}
