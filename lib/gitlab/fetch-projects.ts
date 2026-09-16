/**
 * Fetch live GitLab projects with the user's PAT.
 * Runs on the Next.js server only. Do not log the token.
 */

import { GitlabProbeError } from "@/lib/gitlab/probe";
import { mapGitlabProjectListPayload, type GitlabProjectOption } from "@/lib/gitlab/projects";
import { parsePublicGitlabOrigin } from "@/lib/gitlab/site";

const PAGE_SIZE = 100;
const MAX_PAGES = 2;
const TIMEOUT_MS = 15_000;

/**
 * List projects the token can see (group/name). Caps at 200.
 * @throws GitlabProbeError on non-2xx or timeout.
 */
export async function fetchGitlabProjects(baseUrl: string, token: string): Promise<GitlabProjectOption[]> {
  const origin = parsePublicGitlabOrigin(baseUrl);
  const trimmed = token.trim();
  if (!trimmed) throw new GitlabProbeError("Enter a GitLab personal access token.", 400);

  const out: GitlabProjectOption[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${origin}/api/v4/projects?membership=true&simple=true&per_page=${PAGE_SIZE}&page=${page}&order_by=path&sort=asc`;
    let mapped: GitlabProjectOption[];
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "PRIVATE-TOKEN": trimmed, Accept: "application/json" },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      if (res.status === 401) {
        throw new GitlabProbeError("GitLab rejected that token. It is invalid or has been revoked.", 401);
      }
      if (res.status === 403) {
        throw new GitlabProbeError(
          "This GitLab token is valid but cannot read projects. Grant read_api (or api) on the token.",
          403
        );
      }
      if (res.status < 200 || res.status >= 300) {
        throw new GitlabProbeError("GitLab rejected the project list request", res.status >= 400 ? Math.min(res.status, 502) : 502);
      }
      mapped = mapGitlabProjectListPayload(text ? (JSON.parse(text) as unknown) : []);
    } catch (err) {
      if (err instanceof GitlabProbeError) throw err;
      throw new GitlabProbeError("GitLab is unavailable", 502);
    }
    for (const project of mapped) {
      if (seen.has(project.fullName)) continue;
      seen.add(project.fullName);
      out.push(project);
    }
    if (mapped.length < PAGE_SIZE) break;
  }
  out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return out;
}
