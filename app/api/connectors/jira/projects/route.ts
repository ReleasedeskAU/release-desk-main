import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/api";
import { fetchJiraCloudProjects, JiraProjectsFetchError } from "@/lib/jira/fetch-projects";
import { parsePublicJiraOrigin, JiraSiteError } from "@/lib/jira/site";
import { logger } from "@/lib/logger";
import {
  requiredCredentialField,
  resolveStoredConnector,
  sanitizeListResponse,
  StoredCredentialError,
} from "@/lib/staffless/unmasked-credential";

const pastedSchema = z
  .object({
    baseUrl: z.string().trim().min(8).max(500),
    email: z.string().trim().email().max(320),
    apiToken: z.string().trim().min(1).max(500),
  })
  .strict();
const storedSchema = z.object({ connectorId: z.string().regex(/^\d+$/) }).strict();
const bodySchema = z.union([storedSchema, pastedSchema]);

const lastCallByEmail = new Map<string, number>();
const COOLDOWN_MS = 5_000;

/**
 * List live Jira projects for the wizard. Calls Jira Cloud, not StaffLess.
 * Token and email are not logged and are not stored.
 */
export async function POST(req: Request) {
  const { error } = await requireRole("editor");
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Jira site URL, email, and API token, or a connector id, are required" }, { status: 400 });
  }

  let baseUrl: string;
  let email: string;
  let apiToken: string;
  let cooldown: string;
  try {
    if ("connectorId" in parsed.data) {
      const stored = await resolveStoredConnector(parsed.data.connectorId, "jira");
      email = requiredCredentialField(stored.credentialJson, "jira_user_email");
      apiToken = requiredCredentialField(stored.credentialJson, "jira_api_token");
      baseUrl = stored.baseUrl?.trim() ?? "";
      if (!baseUrl) throw new StoredCredentialError("Stored credential is unavailable", 502);
      cooldown = `connector:${parsed.data.connectorId}`;
    } else {
      baseUrl = parsed.data.baseUrl;
      email = parsed.data.email;
      apiToken = parsed.data.apiToken;
      cooldown = email;
    }
  } catch (err) {
    if (err instanceof StoredCredentialError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("api/connectors/jira/projects", { kind: err instanceof Error ? err.name : "unknown" });
    return NextResponse.json({ error: "Stored credential is unavailable" }, { status: 502 });
  }

  const now = Date.now();
  const last = lastCallByEmail.get(cooldown) ?? 0;
  if (now - last < COOLDOWN_MS) {
    return NextResponse.json({ error: "Please wait a few seconds before listing projects again" }, { status: 429 });
  }
  lastCallByEmail.set(cooldown, now);

  try {
    const origin = parsePublicJiraOrigin(baseUrl);
    const projects = await fetchJiraCloudProjects(origin, email, apiToken);
    return NextResponse.json(sanitizeListResponse({ projects }));
  } catch (err) {
    if (err instanceof JiraSiteError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof JiraProjectsFetchError) {
      logger.warn("api/connectors/jira/projects", { status: err.status });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error("api/connectors/jira/projects", { kind: err instanceof Error ? err.name : "unknown" });
    return NextResponse.json({ error: "Jira is unavailable" }, { status: 502 });
  }
}
