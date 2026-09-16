/**
 * Map a GitLab /projects payload onto { fullName, name, owner } only.
 */

export type GitlabProjectOption = {
  fullName: string;
  name: string;
  owner: string;
  private?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function mapOne(raw: unknown): GitlabProjectOption | null {
  const row = asRecord(raw);
  if (!row) return null;
  const fullName =
    typeof row.path_with_namespace === "string" ? row.path_with_namespace.trim() : "";
  const slash = fullName.lastIndexOf("/");
  if (slash <= 0 || slash === fullName.length - 1) return null;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : fullName.slice(slash + 1);
  return {
    fullName,
    name,
    owner: fullName.slice(0, slash),
    private: row.visibility === "private",
  };
}

/**
 * Accept a GitLab project array. Extra fields are ignored.
 */
export function mapGitlabProjectListPayload(payload: unknown): GitlabProjectOption[] {
  if (!Array.isArray(payload)) return [];
  const seen = new Set<string>();
  const out: GitlabProjectOption[] = [];
  for (const item of payload) {
    const mapped = mapOne(item);
    if (!mapped || seen.has(mapped.fullName)) continue;
    seen.add(mapped.fullName);
    out.push(mapped);
  }
  return out;
}
