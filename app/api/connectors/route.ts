import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/api";
import { BitbucketProbeError } from "@/lib/bitbucket/probe";
import { GithubReposFetchError } from "@/lib/github/fetch-repos";
import { GitlabProbeError } from "@/lib/gitlab/probe";
import { SlackProbeError } from "@/lib/slack/probe";
import { parseOptionalIndexingStart } from "@/lib/jira/project-keys";
import { createStafflessConnector, listStafflessConnectors } from "@/lib/staffless/api";
import { stafflessHttpStatus, stafflessPublicMessage } from "@/lib/staffless/client";
import { logger } from "@/lib/logger";

export async function GET() {
  const { error } = await requireRole("readonly");
  if (error) return error;

  try {
    const rows = await listStafflessConnectors();
    return NextResponse.json(rows);
  } catch (err) {
    logger.error("api/connectors.GET", {
      kind: err instanceof Error ? err.name : "unknown",
      message: err instanceof Error ? err.message : undefined,
    });
    return NextResponse.json(
      { error: stafflessPublicMessage(err) },
      { status: stafflessHttpStatus(err) }
    );
  }
}

export async function POST(req: Request) {
  const { error } = await requireRole("editor");
  if (error) return error;

  const body = (await req.json()) as {
    name?: string;
    type?: string;
    baseUrl?: string;
    credentials?: Record<string, string>;
    config?: Record<string, unknown>;
    pollInterval?: number;
    indexingStart?: string | null;
  };

  if (!body.name?.trim() || !body.type || !body.credentials) {
    return NextResponse.json({ error: "Name, type, and credentials are required" }, { status: 400 });
  }

  const indexingStart = parseOptionalIndexingStart(body.indexingStart);
  if (indexingStart === false) {
    return NextResponse.json({ error: "Sync start date is not valid" }, { status: 400 });
  }

  try {
    const created = await createStafflessConnector({
      name: body.name.trim(),
      type: body.type,
      baseUrl: body.baseUrl,
      credentials: body.credentials,
      config: body.config,
      pollInterval: body.pollInterval,
      indexingStart,
    });
    return NextResponse.json({ id: String(created.id), name: body.name.trim(), type: body.type }, { status: 201 });
  } catch (err) {
    if (
      err instanceof GithubReposFetchError ||
      err instanceof GitlabProbeError ||
      err instanceof BitbucketProbeError ||
      err instanceof SlackProbeError
    ) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status >= 400 ? Math.min(err.status, 502) : 502 }
      );
    }
    logger.error("api/connectors.POST", { kind: err instanceof Error ? err.name : "unknown" });
    const planMessage =
      err instanceof Error &&
      (err.message.startsWith("Unsupported connector") ||
        err.message.includes("needs") ||
        err.message.startsWith("IMAP port"))
        ? err.message
        : null;
    const message = planMessage ?? stafflessPublicMessage(err);
    const status = message === stafflessPublicMessage(err) ? stafflessHttpStatus(err) : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
