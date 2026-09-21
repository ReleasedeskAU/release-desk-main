/**
 * Pure helpers for S3 folder-scope selection.
 *
 * A scope is either a folder prefix ("releases/frontend/") or, for buckets
 * with no folder structure, a filename-pattern filter ("invoice-2024-")
 * which S3 treats as a literal key-prefix filter. The bucket root ("") is
 * never a valid scope — there is no whole-bucket option.
 */

/** Upper bound on connectors created from one onboarding flow. */
export const MAX_S3_SCOPES_PER_FLOW = 10;

/** Folder scopes end in "/"; anything else is a flat-bucket filename pattern. */
export function isFolderScope(scope: string): boolean {
  return scope.endsWith("/");
}

/**
 * Human display for a scope: folder prefixes lose the trailing slash,
 * patterns gain a "*" so nobody mistakes them for exact folder paths.
 */
export function s3ScopeDisplay(scope: string): string {
  if (isFolderScope(scope)) return scope.replace(/\/$/, "");
  return `${scope}*`;
}

/**
 * Fan-out naming for N scopes from one flow: a single scope keeps the
 * tenant's display name untouched; multiple scopes get a suffix so each
 * connector row reads as "<name> — <scope>" (separate-rows decision).
 */
export function s3FanoutName(baseName: string, scope: string, fanOut: boolean): string {
  if (!fanOut) return baseName;
  return `${baseName} (${s3ScopeDisplay(scope)})`;
}

/** Initial selection when editing: the connector's saved single prefix. */
export function initialS3Scopes(config: Record<string, unknown>): string[] {
  const prefix = typeof config.prefix === "string" ? config.prefix.trim() : "";
  return prefix ? [prefix] : [];
}

/**
 * Validates a pasted or typed scope path. Returns the normalized scope, or
 * null with a reason when it cannot be used. The root/empty path is
 * rejected — scope must name at least one folder or filename pattern.
 */
export function normalizeScopeInput(raw: string): { scope?: string; error?: string } {
  const trimmed = raw.trim().replace(/^\/+/, "");
  if (!trimmed) return { error: "Paste a folder path or filename pattern — the whole bucket cannot be selected." };
  if (trimmed.includes("//")) return { error: "Paths cannot contain empty segments (//)." };
  if (trimmed === "*" || /^\*+$/.test(trimmed)) {
    return { error: "S3 has no wildcards — type the start of the filenames instead, e.g. invoice-2024-." };
  }
  if (trimmed.endsWith("/")) return { scope: trimmed };
  // A bare name is ambiguous: treat it as a folder (most buckets browse by
  // folder), the browser confirms by listing it before it can be selected.
  return { scope: `${trimmed}/` };
}

/**
 * Light normalization for an already-stored scope: trims and strips leading
 * slashes but never forces a trailing slash, so flat-bucket filename
 * patterns survive intact (S3 treats them as literal key-prefix filters).
 */
export function normalizeStoredScope(scope: string): string {
  return scope.trim().replace(/^\/+/, "");
}

/** Validates a flat-bucket filename pattern (never gets a trailing slash). */
export function normalizePatternInput(raw: string): { scope?: string; error?: string } {
  const trimmed = raw.trim().replace(/^\/+/, "");
  if (!trimmed) return { error: "Type the start of the filenames to index, e.g. invoice-2024-." };
  if (trimmed.endsWith("/")) return { error: "Patterns match filenames — pick the folder above instead." };
  return { scope: trimmed };
}
