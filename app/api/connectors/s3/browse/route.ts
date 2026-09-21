import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/api";
import { logger } from "@/lib/logger";
import {
  createS3BrowseClient,
  listS3Level,
  normalizeS3Prefix,
  previewS3Scope,
  S3BrowseError,
  S3_DEFAULT_REGION,
  type S3ListClient,
  type S3ScopePreview,
} from "@/lib/s3/browse";
import { normalizeStoredScope } from "@/lib/s3/scopes";

const bodySchema = z
  .object({
    accessKeyId: z.string().trim().min(1).max(256),
    secretAccessKey: z.string().min(1).max(500),
    bucket: z.string().trim().min(1).max(63),
    prefix: z.string().max(1024).optional(),
    prefixes: z.array(z.string().max(1024)).max(10).optional(),
    continuationToken: z.string().max(4096).optional(),
    region: z.string().trim().min(1).max(32).optional(),
    preview: z.boolean().optional(),
  })
  .strict()
  .refine((v) => !(v.prefixes && v.continuationToken), {
    message: "Bulk preview and paging cannot be combined",
  });

const lastCallByKey = new Map<string, number>();
const COOLDOWN_MS = 5_000;

function cooldownKey(accessKeyId: string, bucket: string): string {
  return createHash("sha256").update(`${accessKeyId}\0${bucket}`).digest("hex").slice(0, 16);
}

/**
 * Browse one level of an S3 bucket (or preview a scope) for the connector
 * wizard. Talks to S3 directly with wizard-supplied credentials, not to
 * StaffLess. Credentials are never logged and never stored.
 *
 * POST { accessKeyId, secretAccessKey, bucket, prefix?, continuationToken?,
 *        region?, preview?, prefixes? } ->
 *   level:   { prefix, folders: [{ name, prefix }], files: [{ key, name, size }],
 *              isTruncated, continuationToken? }
 *   preview: { prefix, approxFiles, approxBytes, truncated,
 *              topTypes: [{ ext, count }] }
 *   bulk preview (preview + prefixes, no continuationToken):
 *           { previews: [preview, ...] } — one request previews every scope.
 */
export async function POST(req: Request) {
  const { error } = await requireRole("editor");
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Access key, secret, and bucket are required" }, { status: 400 });
  }
  const { accessKeyId, secretAccessKey, bucket } = parsed.data;
  const prefix = normalizeS3Prefix(parsed.data.prefix ?? "");

  const now = Date.now();
  const key = cooldownKey(accessKeyId, bucket);
  const last = lastCallByKey.get(key) ?? 0;
  if (now - last < COOLDOWN_MS) {
    return NextResponse.json({ error: "Please wait a few seconds before browsing again" }, { status: 429 });
  }
  lastCallByKey.set(key, now);

  // Region is optional: try the default first, then follow one redirect so
  // tenants never have to know their bucket's region up front.
  const regions = parsed.data.region ? [parsed.data.region] : [S3_DEFAULT_REGION];
  // Bulk preview fans out server-side so one request (one cooldown hit)
  // previews every selected scope. Scopes pass through lightly so
  // flat-bucket filename patterns survive verbatim.
  const previewScopes =
    parsed.data.preview === true && parsed.data.prefixes
      ? [...new Set(parsed.data.prefixes.map((p) => normalizeStoredScope(p)).filter(Boolean))]
      : null;
  if (previewScopes && previewScopes.length === 0) {
    return NextResponse.json({ error: "At least one folder scope is required" }, { status: 400 });
  }
  if (parsed.data.preview === true && !parsed.data.prefixes && !normalizeStoredScope(parsed.data.prefix ?? "")) {
    return NextResponse.json({ error: "A folder scope is required" }, { status: 400 });
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const client: S3ListClient = createS3BrowseClient({
      accessKeyId,
      secretAccessKey,
      region: regions[0],
    });
    try {
      if (previewScopes) {
        const previews: S3ScopePreview[] = [];
        for (const scope of previewScopes) {
          previews.push(await previewS3Scope(client, bucket, scope));
        }
        return NextResponse.json({ previews });
      }
      if (parsed.data.preview === true) {
        const preview = await previewS3Scope(client, bucket, prefix);
        return NextResponse.json({ preview });
      }
      const page = await listS3Level(client, bucket, prefix, parsed.data.continuationToken);
      return NextResponse.json({ page });
    } catch (err) {
      const redirect =
        !parsed.data.region && err instanceof S3BrowseError ? err.redirectRegion : undefined;
      if (redirect && redirect !== regions[0]) {
        regions[0] = redirect;
        continue;
      }
      if (err instanceof S3BrowseError) {
        if (err.status >= 500) logger.error("api/connectors/s3/browse", { status: err.status });
        else logger.warn("api/connectors/s3/browse", { status: err.status });
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      logger.error("api/connectors/s3/browse", { kind: err instanceof Error ? err.name : "unknown" });
      return NextResponse.json({ error: "S3 is unavailable" }, { status: 502 });
    }
  }
  return NextResponse.json({ error: "S3 is unavailable" }, { status: 502 });
}
