/**
 * Server-side S3 prefix browser for connector onboarding.
 *
 * Lets the "Add Connector" wizard drill into a bucket one level at a time
 * (ListObjectsV2 + Delimiter="/") and build approximate scope previews,
 * without ever downloading object bodies. All AWS calls stay server-side so
 * the access key and secret never reach the browser.
 *
 * Error contract: every failure surfaces as {@link S3BrowseError} with an
 * HTTP-style status the API route can forward. Messages are safe to show to
 * the tenant — they never include credentials or raw AWS internals.
 */

import {
  ListObjectsV2Command,
  type ListObjectsV2CommandInput,
  type ListObjectsV2Output,
  S3Client,
} from "@aws-sdk/client-s3";
import { normalizeStoredScope } from "./scopes";

/** S3 returns at most 1,000 keys per ListObjectsV2 call. */
export const S3_LIST_PAGE_SIZE = 1000;
/** Preview sampling stops after this many pages — previews stay approximate. */
export const S3_PREVIEW_MAX_PAGES = 5;
/** Hard stop on sampled keys per preview so huge scopes stay cheap. */
export const S3_PREVIEW_MAX_KEYS = 5000;
/** First region tried when the tenant does not specify one. */
export const S3_DEFAULT_REGION = "us-east-1";
/** How many file extensions a preview reports. */
export const S3_PREVIEW_TOP_TYPES = 8;

/** Minimal client surface — lets tests inject a fake without the real SDK. */
export type S3ListClient = Pick<S3Client, "send">;

export type S3BrowseStatus = 400 | 401 | 403 | 404 | 429 | 502;

/** Typed browse failure. `prefix` marks which drilled path was denied. */
export class S3BrowseError extends Error {
  readonly status: S3BrowseStatus;
  readonly prefix?: string;
  /**
   * Real bucket region, present only on redirect failures. Operational, not
   * sensitive — lets the route retry once without asking the tenant.
   */
  readonly redirectRegion?: string;

  constructor(status: S3BrowseStatus, message: string, prefix?: string, redirectRegion?: string) {
    super(message);
    this.name = "S3BrowseError";
    this.status = status;
    if (prefix !== undefined) this.prefix = prefix;
    if (redirectRegion !== undefined) this.redirectRegion = redirectRegion;
  }
}

export interface S3FolderEntry {
  /** Display name of the folder within its parent level. */
  name: string;
  /** Full prefix selecting this folder (always ends with "/"). */
  prefix: string;
}

export interface S3LevelPage {
  /** The prefix that was listed ("" for the bucket root). */
  prefix: string;
  /** Sub-folders directly under this level (this page of them). */
  folders: S3FolderEntry[];
  /** Files directly at this level (this page of them). */
  files: { key: string; name: string; size: number }[];
  /** True when more entries remain — the UI offers "load more". */
  isTruncated: boolean;
  /** Opaque cursor for the next page; absent when `isTruncated` is false. */
  continuationToken?: string;
}

export interface S3ScopePreview {
  prefix: string;
  /** Sampled file count — always labeled "approximate" in the UI. */
  approxFiles: number;
  /** Sampled byte total — always labeled "approximate" in the UI. */
  approxBytes: number;
  /** True when sampling stopped before exhausting the scope. */
  truncated: boolean;
  /** Most common extensions in the sample, descending. */
  topTypes: { ext: string; count: number }[];
}

/** "releases/frontend/" stays; "releases" becomes "releases/"; "" stays root. */
export function normalizeS3Prefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\/+/, "");
  if (trimmed === "") return "";
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

/** "a/b/report.PDF " -> "pdf"; extensionless names -> "(none)". */
export function s3KeyExtension(key: string): string {
  const base = key.split("/").pop() ?? key;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "(none)";
  return base.slice(dot + 1).toLowerCase().slice(0, 12);
}

function awsErrorName(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";
  const name = (err as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

/**
 * Maps an AWS SDK failure to a tenant-safe S3BrowseError.
 * Auth details are deliberately generic — the message must not reveal
 * whether the key id, the secret, or the bucket policy is at fault.
 */
export function toS3BrowseError(err: unknown, prefix?: string): S3BrowseError {
  if (err instanceof S3BrowseError) return err;
  const name = awsErrorName(err);
  switch (name) {
    case "NoSuchBucket":
    case "NotFound":
    case "NoSuchKey":
      return new S3BrowseError(404, "Bucket not found or not accessible with these credentials.", prefix);
    case "AccessDenied":
    case "Forbidden":
    case "AllAccessDisabled":
      return new S3BrowseError(
        403,
        prefix
          ? `Access denied to "${prefix}". The credentials can list the parent level but not read inside this folder.`
          : "Access denied. The credentials cannot list this bucket.",
        prefix,
      );
    case "InvalidAccessKeyId":
    case "SignatureDoesNotMatch":
    case "UnrecognizedClientException":
    case "ExpiredToken":
    case "InvalidClientTokenId":
      return new S3BrowseError(400, "Could not authenticate to S3 — check the access key and secret.", prefix);
    case "PermanentRedirect":
      return new S3BrowseError(
        400,
        "The bucket lives in a different region. Set the region explicitly and try again.",
        prefix,
        extractRedirectRegion(err) ?? undefined,
      );
    case "TooManyRequestsException":
    case "RequestLimitExceeded":
    case "SlowDown":
      return new S3BrowseError(429, "S3 is throttling requests. Wait a moment and try again.", prefix);
    default:
      return new S3BrowseError(502, "Could not reach S3. Check the bucket name and try again.", prefix);
  }
}

/**
 * Best-effort extraction of the real bucket region from a PermanentRedirect
 * failure, so the route can retry once without asking the tenant for a
 * region they usually do not know. Returns null when it cannot tell.
 */
export function extractRedirectRegion(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const record = err as Record<string, unknown>;
  const direct = record["BucketRegion"];
  if (typeof direct === "string" && direct.length > 0) return direct;
  const endpoint = record["Endpoint"];
  if (typeof endpoint === "string") {
    // Endpoints look like "<bucket>.s3.<region>.amazonaws.com".
    const match = /\.s3[.-]([a-z0-9-]+)\.amazonaws\.com/i.exec(endpoint);
    if (match?.[1] && match[1] !== "amazonaws") return match[1].toLowerCase();
  }
  return null;
}

async function sendList(
  client: S3ListClient,
  bucket: string,
  input: Omit<ListObjectsV2CommandInput, "Bucket">,
  prefix: string,
): Promise<ListObjectsV2Output> {
  try {
    return (await client.send(new ListObjectsV2Command({ Bucket: bucket, ...input }))) as ListObjectsV2Output;
  } catch (err) {
    throw toS3BrowseError(err, prefix || undefined);
  }
}

/**
 * Lists one level of a bucket: immediate sub-folders (via Delimiter="/")
 * plus files directly at that level. One page per call — the route passes
 * `continuationToken` back for "load more" instead of draining >1,000-entry
 * levels server-side, keeping each browse step fast.
 */
export async function listS3Level(
  client: S3ListClient,
  bucket: string,
  prefix: string,
  continuationToken?: string,
): Promise<S3LevelPage> {
  const normalized = normalizeS3Prefix(prefix);
  const out = await sendList(
    client,
    bucket,
    {
      Prefix: normalized || undefined,
      Delimiter: "/",
      MaxKeys: S3_LIST_PAGE_SIZE,
      ContinuationToken: continuationToken || undefined,
    },
    normalized,
  );
  const folders: S3FolderEntry[] = (out.CommonPrefixes ?? [])
    .map((p) => p.Prefix ?? "")
    .filter((p) => p.length > normalized.length)
    .map((full) => ({ name: full.slice(normalized.length).replace(/\/$/, ""), prefix: full }));
  const files = (out.Contents ?? [])
    .filter((o) => (o.Key ?? "").length > normalized.length)
    .map((o) => {
      const key = o.Key as string;
      return { key, name: key.slice(normalized.length), size: o.Size ?? 0 };
    });
  const page: S3LevelPage = {
    prefix: normalized,
    folders,
    files,
    isTruncated: out.IsTruncated === true,
  };
  if (out.NextContinuationToken) page.continuationToken = out.NextContinuationToken;
  return page;
}

/**
 * Samples up to S3_PREVIEW_MAX_PAGES of keys under a scope (no delimiter,
 * so nested objects count too) and aggregates counts, bytes, and top file
 * types. Every number is a sample — the UI must label them approximate.
 * Scopes pass through lightly: folder prefixes keep their trailing slash
 * and flat-bucket filename patterns are used verbatim.
 */
export async function previewS3Scope(
  client: S3ListClient,
  bucket: string,
  prefix: string,
): Promise<S3ScopePreview> {
  const normalized = normalizeStoredScope(prefix);
  let approxFiles = 0;
  let approxBytes = 0;
  const typeCounts = new Map<string, number>();
  let token: string | undefined;
  let truncated = false;

  for (let page = 0; page < S3_PREVIEW_MAX_PAGES; page += 1) {
    const out = await sendList(
      client,
      bucket,
      { Prefix: normalized || undefined, MaxKeys: S3_LIST_PAGE_SIZE, ContinuationToken: token },
      normalized,
    );
    for (const obj of out.Contents ?? []) {
      if (approxFiles >= S3_PREVIEW_MAX_KEYS) break;
      approxFiles += 1;
      approxBytes += obj.Size ?? 0;
      const ext = s3KeyExtension(obj.Key ?? "");
      typeCounts.set(ext, (typeCounts.get(ext) ?? 0) + 1);
    }
    if (out.IsTruncated === true && out.NextContinuationToken && approxFiles < S3_PREVIEW_MAX_KEYS) {
      token = out.NextContinuationToken;
      truncated = true;
    } else {
      truncated = out.IsTruncated === true;
      break;
    }
  }

  const topTypes = [...typeCounts.entries()]
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, S3_PREVIEW_TOP_TYPES);
  return { prefix: normalized, approxFiles, approxBytes, truncated, topTypes };
}

/** Builds a real S3 client from wizard-supplied credentials (server-side only). */
export function createS3BrowseClient(args: {
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}): S3Client {
  return new S3Client({
    region: args.region || S3_DEFAULT_REGION,
    credentials: { accessKeyId: args.accessKeyId, secretAccessKey: args.secretAccessKey },
  });
}
