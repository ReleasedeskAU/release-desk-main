/**
 * GitLab path_with_namespace values used in StaffLess config.
 * Nested groups are allowed (group/sub/project). Refuse path traversal.
 */

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

export type GitlabProjectRef = { owner: string; name: string; fullName: string };

export type GitlabProjectSelection = {
  owner: string;
  name: string;
  paths: string[];
};

/**
 * Normalize group/name (nested groups ok). Returns null when the value is not a project path.
 */
export function normalizeGitlabProject(raw: unknown): GitlabProjectRef | null {
  if (typeof raw !== "string") return null;
  const fullName = raw
    .trim()
    .replace(/^https?:\/\/[^/]+\//i, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  const parts = fullName.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  if (parts.some((part) => part === "." || part === ".." || !SEGMENT.test(part))) return null;
  const name = parts[parts.length - 1];
  const owner = parts.slice(0, -1).join("/");
  return { owner, name, fullName: `${owner}/${name}` };
}

/**
 * Unique, allow-listed GitLab projects from the wizard.
 * Mixed groups are allowed — the engine indexes each path.
 * @throws Error when a value is not a project path.
 */
export function parseGitlabProjectSelection(config?: Record<string, unknown>): GitlabProjectSelection {
  const fromList = Array.isArray(config?.projects) ? config.projects : null;
  if (fromList) return selectionFromRefs(fromList.map((item) => normalizeGitlabProject(item)));

  const fromCsv = typeof config?.projects === "string" ? config.projects : "";
  if (fromCsv.trim()) {
    return selectionFromRefs(fromCsv.split(",").map((part) => normalizeGitlabProject(part)));
  }

  const ownerRaw = typeof config?.projectOwner === "string" ? config.projectOwner.trim() : "";
  const nameRaw = typeof config?.projectName === "string" ? config.projectName.trim() : "";
  if (ownerRaw && nameRaw) {
    const ref = normalizeGitlabProject(`${ownerRaw}/${nameRaw}`);
    if (ref) return { owner: ref.owner, name: ref.name, paths: [ref.fullName] };
  }

  throw new Error("GitLab needs a token, site URL, and at least one project");
}

function selectionFromRefs(refs: Array<GitlabProjectRef | null>): GitlabProjectSelection {
  const paths: string[] = [];
  for (const ref of refs) {
    if (!ref) throw new Error("Each GitLab project must be group/name");
    if (!paths.includes(ref.fullName)) paths.push(ref.fullName);
  }
  if (paths.length === 0) {
    throw new Error("GitLab needs a token, site URL, and at least one project");
  }
  const first = normalizeGitlabProject(paths[0]);
  if (!first) throw new Error("Each GitLab project must be group/name");
  return { owner: first.owner, name: first.name, paths };
}
