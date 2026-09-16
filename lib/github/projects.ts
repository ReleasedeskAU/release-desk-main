/**
 * Map a GitHub /user/repos payload onto { fullName, name, owner, private } only.
 */

export type GithubRepoOption = {
  fullName: string;
  name: string;
  owner: string;
  private?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function mapOne(raw: unknown): GithubRepoOption | null {
  const row = asRecord(raw);
  if (!row) return null;
  const fullName = typeof row.full_name === "string" ? row.full_name.trim() : "";
  const parts = fullName.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : parts[1];
  return {
    fullName,
    name,
    owner: parts[0],
    private: row.private === true,
  };
}

/**
 * Accept a GitHub repo array. Extra fields are ignored.
 */
export function mapGithubRepoListPayload(payload: unknown): GithubRepoOption[] {
  if (!Array.isArray(payload)) return [];
  const seen = new Set<string>();
  const out: GithubRepoOption[] = [];
  for (const item of payload) {
    const mapped = mapOne(item);
    if (!mapped || seen.has(mapped.fullName)) continue;
    seen.add(mapped.fullName);
    out.push(mapped);
  }
  return out;
}
