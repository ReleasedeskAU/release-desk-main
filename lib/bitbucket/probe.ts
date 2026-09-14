/**
 * Probe Bitbucket Cloud with the same Basic-auth email + scoped token the
 * index engine uses. Do not log the token or email.
 */

import { CatalogCreateError } from "@/lib/admin-connectors/plan-create";
import { logger } from "@/lib/logger";

const BITBUCKET_API = "https://api.bitbucket.org/2.0";
const TIMEOUT_MS = 15_000;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const BITBUCKET_ENGINE_STALE_CHECK =
  "Bitbucket accepted these credentials. Restart the index engine and try again.";

export class BitbucketProbeError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "BitbucketProbeError";
    this.status = status;
  }
}

export type BitbucketProbeInput = {
  email: string;
  token: string;
  workspace: string;
  repositories?: string;
};

/**
 * First comma-separated slug, or empty when the field is blank.
 * @throws CatalogCreateError when the value is not a Bitbucket URL slug.
 */
export function firstBitbucketSlug(raw: unknown, label: string, required: boolean): string {
  const text = typeof raw === "string" ? raw.split(/[\n,]+/)[0]?.trim() ?? "" : "";
  if (!text) {
    if (required) throw new CatalogCreateError(`${label} is required`);
    return "";
  }
  if (!SLUG.test(text)) {
    throw new CatalogCreateError(
      `${label} must be the slug from the Bitbucket URL, not a username or full path.`
    );
  }
  return text;
}

function basicAuth(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`, "utf8").toString("base64")}`;
}

async function bitbucketStatus(path: string, email: string, token: string): Promise<number> {
  const res = await fetch(`${BITBUCKET_API}${path}`, {
    method: "GET",
    headers: {
      Authorization: basicAuth(email, token),
      Accept: "application/json",
    },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await res.text().catch(() => "");
  return res.status;
}

function publicBitbucketStatusMessage(status: number): string {
  if (status === 401) return "Bitbucket rejected the credentials.";
  if (status === 403) return "Bitbucket denied access to that workspace.";
  if (status === 404) return "Bitbucket could not find that workspace or repository.";
  if (status >= 400 && status < 500) return "Bitbucket rejected the request.";
  return "Bitbucket is unavailable";
}

/**
 * Confirm the token can see the workspace or named repo before the engine pair.
 * @throws BitbucketProbeError when Bitbucket rejects auth or cannot see the target.
 * @throws CatalogCreateError when workspace/repo slugs are malformed.
 */
export async function assertBitbucketConnectorReachable(input: BitbucketProbeInput): Promise<void> {
  const workspace = firstBitbucketSlug(input.workspace, "Workspace", true);
  const repo = firstBitbucketSlug(input.repositories, "Repository slugs", false);
  const email = input.email.trim();
  const token = input.token.trim();
  if (!email || !token) {
    throw new BitbucketProbeError("Bitbucket rejected the credentials.", 401);
  }

  try {
    const repoStatus = repo
      ? await bitbucketStatus(
          `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}`,
          email,
          token
        )
      : null;
    if (repoStatus === 200) {
      logger.info("bitbucket.probe", { repoStatus, hasRepo: true });
      return;
    }
    if (repoStatus === 401) {
      throw new BitbucketProbeError(publicBitbucketStatusMessage(401), 401);
    }

    const workspaceStatus = await bitbucketStatus(
      `/workspaces/${encodeURIComponent(workspace)}`,
      email,
      token
    );
    logger.info("bitbucket.probe", { repoStatus, workspaceStatus, hasRepo: Boolean(repo) });
    if (workspaceStatus === 200) return;

    const status = repoStatus ?? workspaceStatus;
    throw new BitbucketProbeError(publicBitbucketStatusMessage(status), status);
  } catch (err) {
    if (err instanceof BitbucketProbeError || err instanceof CatalogCreateError) throw err;
    logger.warn("bitbucket.probe_failed", { kind: err instanceof Error ? err.name : "unknown" });
    throw new BitbucketProbeError("Bitbucket is unavailable", 502);
  }
}

/** True when the engine still failed after Bitbucket itself accepted the token. */
export function isStaleBitbucketEngineCheck(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("could not find that workspace") ||
    lower.includes("denied access to that workspace")
  );
}
