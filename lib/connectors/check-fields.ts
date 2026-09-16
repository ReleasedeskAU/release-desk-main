/**
 * Wizard Check fields: local payload shape, plus live GitHub / GitLab / Bitbucket / Jira token probes.
 * Never logs credentials or vendor response bodies.
 */

import { assertBitbucketTokenReachable } from "@/lib/bitbucket/probe";
import { assertGithubTokenReachable } from "@/lib/github/probe";
import { assertGitlabTokenReachable } from "@/lib/gitlab/probe";
import { assertJiraTokenReachable } from "@/lib/jira/probe";
import { planStafflessCreate } from "@/lib/staffless/create-payload";

export type ConnectorFieldCheckInput = {
  type: string;
  baseUrl?: string;
  credentials: Record<string, string>;
  config?: Record<string, unknown>;
};

export type ConnectorFieldCheckResult = {
  ok: boolean;
  message: string;
};

/**
 * Validate wizard credentials. GitHub, GitLab, Bitbucket, and Jira are checked with the vendor now.
 * Jira names URL vs email vs token vs unreachable vs 401/403/404. Other sources
 * still check field shape only.
 */
export async function evaluateConnectorFieldCheck(
  input: ConnectorFieldCheckInput
): Promise<ConnectorFieldCheckResult> {
  try {
    const type = input.type.trim().toLowerCase();
    // Jira: named URL/email/token errors first. Create-plan lumps those into one line.
    if (type === "jira") {
      await assertJiraTokenReachable(
        input.baseUrl ?? "",
        input.credentials.email ?? "",
        input.credentials.apiToken ?? ""
      );
    }
    if (type === "gitlab") {
      await assertGitlabTokenReachable(input.baseUrl ?? "", input.credentials.token ?? "");
      return { ok: true, message: "GitLab accepted this token." };
    }
    if (type === "bitbucket") {
      await assertBitbucketTokenReachable(input.credentials.email ?? "", input.credentials.token ?? "");
      return { ok: true, message: "Bitbucket accepted these credentials." };
    }
    planStafflessCreate({
      name: "test",
      type: input.type,
      baseUrl: input.baseUrl,
      credentials: input.credentials,
      config: input.config,
    });
    if (type === "github") {
      await assertGithubTokenReachable(input.credentials.token ?? "");
      return { ok: true, message: "GitHub accepted this token." };
    }
    if (type === "jira") {
      return { ok: true, message: "Jira accepted these credentials." };
    }
    return {
      ok: true,
      message: "Fields look valid. StaffLess AI will verify credentials on Sync Now.",
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Invalid connector fields",
    };
  }
}
