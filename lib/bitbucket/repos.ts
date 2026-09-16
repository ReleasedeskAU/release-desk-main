/**
 * Bitbucket workspace/slug values used in StaffLess config.
 */

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type BitbucketRepoRef = { workspace: string; name: string; fullName: string };

export type BitbucketRepoSelection = {
  workspace: string;
  names: string[];
  allRepos: boolean;
};

/**
 * Normalize workspace/slug. Returns null when the value is not a Bitbucket repo path.
 */
export function normalizeBitbucketRepo(raw: unknown): BitbucketRepoRef | null {
  if (typeof raw !== "string") return null;
  const fullName = raw
    .trim()
    .replace(/^https?:\/\/bitbucket\.org\//i, "")
    .replace(/\/+$/, "");
  const parts = fullName.split("/");
  if (parts.length !== 2) return null;
  const workspace = parts[0];
  const name = parts[1];
  if (!SLUG.test(workspace) || !SLUG.test(name) || name === "." || name === "..") return null;
  return { workspace, name, fullName: `${workspace}/${name}` };
}

/**
 * Unique, allow-listed repos from the wizard, one workspace per connector.
 * @throws Error when a value is not workspace/slug or workspaces are mixed.
 */
export function parseBitbucketRepoSelection(config?: Record<string, unknown>): BitbucketRepoSelection {
  if (config?.allRepos === true) {
    const workspaceRaw = typeof config.workspace === "string" ? config.workspace.trim() : "";
    if (!SLUG.test(workspaceRaw)) {
      throw new Error("Bitbucket needs email, API token, and at least one repository");
    }
    return { workspace: workspaceRaw, names: [], allRepos: true };
  }

  const fromList = Array.isArray(config?.repos) ? config.repos : null;
  if (fromList) return selectionFromRefs(fromList.map((item) => normalizeBitbucketRepo(item)));

  const workspaceRaw = typeof config?.workspace === "string" ? config.workspace.trim() : "";
  const namesRaw = typeof config?.repositories === "string" ? config.repositories : "";
  if (SLUG.test(workspaceRaw) && namesRaw.trim()) {
    const names = namesRaw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    return selectionFromRefs(names.map((name) => normalizeBitbucketRepo(`${workspaceRaw}/${name}`)));
  }

  throw new Error("Bitbucket needs email, API token, and at least one repository");
}

/**
 * Group selected full names by workspace for one StaffLess connector per workspace.
 */
export function groupBitbucketReposByWorkspace(fullNames: string[]): BitbucketRepoSelection[] {
  const grouped = new Map<string, string[]>();
  for (const raw of fullNames) {
    const ref = normalizeBitbucketRepo(raw);
    if (!ref) throw new Error("Each Bitbucket repository must be workspace/slug");
    const names = grouped.get(ref.workspace) ?? [];
    if (!names.includes(ref.name)) names.push(ref.name);
    grouped.set(ref.workspace, names);
  }
  return [...grouped.entries()].map(([workspace, names]) => ({
    workspace,
    names,
    allRepos: false,
  }));
}

function selectionFromRefs(refs: Array<BitbucketRepoRef | null>): BitbucketRepoSelection {
  const workspaces = new Set<string>();
  const names: string[] = [];
  for (const ref of refs) {
    if (!ref) throw new Error("Each Bitbucket repository must be workspace/slug");
    workspaces.add(ref.workspace);
    if (!names.includes(ref.name)) names.push(ref.name);
  }
  if (workspaces.size !== 1 || names.length === 0) {
    throw new Error("Bitbucket needs email, API token, and at least one repository");
  }
  return { workspace: [...workspaces][0], names, allRepos: false };
}
