/**
 * Map the ReleaseDesk connector wizard onto StaffLess AI create payloads.
 * Add Connector still needs credential + cc-pair after POST /admin/connector
 * or StaffLess cannot index.
 */

import { parseBitbucketRepoSelection } from "@/lib/bitbucket/repos";
import { parseGithubRepoSelection } from "@/lib/github/repos";
import { parseGitlabProjectSelection } from "@/lib/gitlab/selection";
import { parsePublicGitlabOrigin } from "@/lib/gitlab/site";
import { allowedSenderValues } from "@/lib/imap/allowed-senders";
import { parseImapMailboxNames } from "@/lib/imap/mailboxes";
import { isJiraAllProjects, jiraProjectInJql, parseJiraProjectKeys } from "@/lib/jira/project-keys";
import { parseSlackChannelNames } from "@/lib/slack/fetch-channels";

export type WizardConnectorInput = {
  name: string;
  type: string;
  baseUrl?: string;
  config?: Record<string, unknown>;
  pollInterval?: number;
  /** StaffLess connector.indexing_start ISO UTC, or omit for all time. */
  indexingStart?: string | null;
};

export type WizardCreateInput = WizardConnectorInput & {
  credentials: Record<string, string>;
};

export type StafflessCreatePlan = {
  credential: {
    name: string;
    source: string;
    admin_public: boolean;
    credential_json: Record<string, string>;
  };
  connector: {
    name: string;
    source: string;
    input_type: string;
    access_type: "public";
    groups: number[];
    refresh_freq: number;
    indexing_start?: string | null;
    connector_specific_config: Record<string, unknown>;
  };
};

const SUPPORTED = new Set(["jira", "github", "gitlab", "bitbucket", "teams", "imap", "slack", "s3"]);
const IMAP_DEFAULT_PORT = 993;
const IMAP_MAX_PORT = 65535;

/** True when StaffLess can create/update this source (jira, github, gitlab, bitbucket, teams, imap, slack). */
export function isStafflessConnectorType(type: string): boolean {
  return SUPPORTED.has(type.trim().toLowerCase());
}

function refreshSeconds(pollInterval?: number): number {
  return Math.max(60, (pollInterval ?? 15) * 60);
}

/**
 * Connector body for create or PATCH. Does not include secrets.
 * @throws Error when the type is unsupported or required config is missing.
 */
export function planStafflessConnector(input: WizardConnectorInput): StafflessCreatePlan["connector"] {
  const type = input.type.trim().toLowerCase();
  if (!SUPPORTED.has(type)) {
    throw new Error("Unsupported connector type");
  }
  const refresh = refreshSeconds(input.pollInterval);
  if (type === "jira") return jiraConnector(input, refresh);
  if (type === "github") return githubConnector(input, refresh);
  if (type === "gitlab") return gitlabConnector(input, refresh);
  if (type === "bitbucket") return bitbucketConnector(input, refresh);
  if (type === "teams") return teamsConnector(input, refresh);
  if (type === "slack") return slackConnector(input, refresh);
  if (type === "s3") return s3Connector(input, refresh);
  return imapConnector(input, refresh);
}

/**
 * Build StaffLess credential + connector bodies from the wizard.
 * @throws Error when the type is unsupported or required fields are missing.
 */
export function planStafflessCreate(input: WizardCreateInput): StafflessCreatePlan {
  const type = input.type.trim().toLowerCase();
  if (!SUPPORTED.has(type)) {
    throw new Error("Unsupported connector type");
  }
  const refresh = refreshSeconds(input.pollInterval);
  if (type === "jira") return jiraPlan(input, refresh);
  if (type === "github") return githubPlan(input, refresh);
  if (type === "gitlab") return gitlabPlan(input, refresh);
  if (type === "bitbucket") return bitbucketPlan(input, refresh);
  if (type === "teams") return teamsPlan(input, refresh);
  if (type === "slack") return slackPlan(input, refresh);
  if (type === "s3") return s3Plan(input, refresh);
  return imapPlan(input, refresh);
}

function requiredText(value: unknown, message: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(message);
  return text;
}

function commaList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function jiraConnector(input: WizardConnectorInput, refresh: number): StafflessCreatePlan["connector"] {
  const baseUrl = input.baseUrl?.trim();
  if (!baseUrl) {
    throw new Error("Jira needs email, API token, base URL, and at least one project");
  }
  const allProjects = isJiraAllProjects(input.config);
  const keys = parseJiraProjectKeys(input.config);
  if (!allProjects && keys.length === 0) {
    throw new Error("Jira needs email, API token, base URL, and at least one project");
  }
  const connector_specific_config: Record<string, unknown> = {
    jira_base_url: baseUrl.replace(/\/+$/, ""),
    comment_email_blacklist: [],
  };
  if (!allProjects && keys.length === 1) {
    connector_specific_config.project_key = keys[0];
  } else if (!allProjects) {
    connector_specific_config.jql_query = jiraProjectInJql(keys);
  }
  return {
    name: input.name,
    source: "jira",
    input_type: "poll",
    access_type: "public",
    groups: [],
    refresh_freq: refresh,
    ...(input.indexingStart ? { indexing_start: input.indexingStart } : {}),
    connector_specific_config,
  };
}

function jiraPlan(input: WizardCreateInput, refresh: number): StafflessCreatePlan {
  const email = input.credentials.email?.trim();
  const token = input.credentials.apiToken?.trim();
  if (!email || !token) {
    throw new Error("Jira needs email, API token, base URL, and at least one project");
  }
  return {
    credential: {
      name: `${input.name} credentials`,
      source: "jira",
      admin_public: true,
      credential_json: { jira_user_email: email, jira_api_token: token },
    },
    connector: jiraConnector(input, refresh),
  };
}

function githubIncludeFlags(config?: Record<string, unknown>): {
  include_prs: boolean;
  include_issues: boolean;
  include_files: boolean;
  include_overview: boolean;
  include_commits: boolean;
} {
  const types = Array.isArray(config?.dataTypes)
    ? config.dataTypes.filter((v): v is string => typeof v === "string")
    : null;
  if (types && types.length === 0) {
    throw new Error(
      "GitHub needs at least one of pull requests, issues, repository overview, commits, or documents"
    );
  }
  if (!types) {
    return {
      include_prs: true,
      include_issues: true,
      include_files: false,
      include_overview: true,
      include_commits: true,
    };
  }
  const flags = {
    include_prs: types.includes("pull_requests"),
    include_issues: types.includes("issues"),
    include_files: types.includes("files"),
    include_overview: types.includes("repository_overview"),
    include_commits: types.includes("commits"),
  };
  if (
    !flags.include_prs &&
    !flags.include_issues &&
    !flags.include_files &&
    !flags.include_overview &&
    !flags.include_commits
  ) {
    throw new Error(
      "GitHub needs at least one of pull requests, issues, repository overview, commits, or documents"
    );
  }
  return flags;
}

function githubConnector(input: WizardConnectorInput, refresh: number): StafflessCreatePlan["connector"] {
  const selection = parseGithubRepoSelection(input.config);
  const flags = githubIncludeFlags(input.config);
  const connector_specific_config: Record<string, unknown> = {
    repo_owner: selection.owner,
    include_prs: flags.include_prs,
    include_issues: flags.include_issues,
    include_files: flags.include_files,
    include_overview: flags.include_overview,
    include_commits: flags.include_commits,
  };
  if (!selection.allRepos) {
    connector_specific_config.repositories = selection.names.join(",");
  }
  return {
    name: input.name,
    source: "github",
    input_type: "poll",
    access_type: "public",
    groups: [],
    refresh_freq: refresh,
    ...(input.indexingStart ? { indexing_start: input.indexingStart } : {}),
    connector_specific_config,
  };
}

function githubPlan(input: WizardCreateInput, refresh: number): StafflessCreatePlan {
  const token = input.credentials.token?.trim();
  if (!token) {
    throw new Error("GitHub needs a token and at least one repository");
  }
  return {
    credential: {
      name: `${input.name} credentials`,
      source: "github",
      admin_public: true,
      credential_json: { github_access_token: token },
    },
    connector: githubConnector(input, refresh),
  };
}

function dataTypeList(config?: Record<string, unknown>): string[] | null {
  return Array.isArray(config?.dataTypes)
    ? config.dataTypes.filter((v): v is string => typeof v === "string")
    : null;
}

function gitlabIncludeFlags(config?: Record<string, unknown>): {
  include_mrs: boolean;
  include_issues: boolean;
  include_overview: boolean;
  include_commits: boolean;
} {
  const types = dataTypeList(config);
  if (types && types.length === 0) {
    throw new Error("GitLab needs at least one of merge requests, issues, project overview, or commits");
  }
  if (!types) {
    return { include_mrs: true, include_issues: true, include_overview: true, include_commits: true };
  }
  const flags = {
    include_mrs: types.includes("pull_requests"),
    include_issues: types.includes("issues"),
    include_overview: types.includes("repository_overview"),
    include_commits: types.includes("commits"),
  };
  if (!flags.include_mrs && !flags.include_issues && !flags.include_overview && !flags.include_commits) {
    throw new Error("GitLab needs at least one of merge requests, issues, project overview, or commits");
  }
  return flags;
}

function gitlabConnector(input: WizardConnectorInput, refresh: number): StafflessCreatePlan["connector"] {
  const selection = parseGitlabProjectSelection(input.config);
  const flags = gitlabIncludeFlags(input.config);
  return {
    name: input.name,
    source: "gitlab",
    input_type: "poll",
    access_type: "public",
    groups: [],
    refresh_freq: refresh,
    ...(input.indexingStart ? { indexing_start: input.indexingStart } : {}),
    connector_specific_config: {
      project_owner: selection.owner,
      project_name: selection.name,
      projects: selection.paths.join(","),
      include_mrs: flags.include_mrs,
      include_issues: flags.include_issues,
      include_overview: flags.include_overview,
      include_commits: flags.include_commits,
      include_code_files: false,
    },
  };
}

function gitlabPlan(input: WizardCreateInput, refresh: number): StafflessCreatePlan {
  const token = input.credentials.token?.trim();
  const baseUrl = input.baseUrl?.trim();
  if (!token || !baseUrl) {
    throw new Error("GitLab needs a token, site URL, and at least one project");
  }
  const origin = parsePublicGitlabOrigin(baseUrl);
  return {
    credential: {
      name: `${input.name} credentials`,
      source: "gitlab",
      admin_public: true,
      credential_json: { gitlab_url: origin, gitlab_access_token: token },
    },
    connector: gitlabConnector(input, refresh),
  };
}

function bitbucketIncludeFlags(config?: Record<string, unknown>): {
  include_prs: boolean;
  include_repo: boolean;
  include_readme: boolean;
  include_commits: boolean;
} {
  const types = dataTypeList(config);
  if (types && types.length === 0) {
    throw new Error("Bitbucket needs at least one of pull requests, repository overview, or commits");
  }
  if (!types) {
    return { include_prs: true, include_repo: true, include_readme: true, include_commits: true };
  }
  const overview = types.includes("repository_overview");
  const flags = {
    include_prs: types.includes("pull_requests"),
    include_repo: overview,
    include_readme: overview,
    include_commits: types.includes("commits"),
  };
  if (!flags.include_prs && !flags.include_repo && !flags.include_readme && !flags.include_commits) {
    throw new Error("Bitbucket needs at least one of pull requests, repository overview, or commits");
  }
  return flags;
}

function bitbucketConnector(input: WizardConnectorInput, refresh: number): StafflessCreatePlan["connector"] {
  const selection = parseBitbucketRepoSelection(input.config);
  const flags = bitbucketIncludeFlags(input.config);
  const connector_specific_config: Record<string, unknown> = {
    workspace: selection.workspace,
    include_prs: flags.include_prs,
    include_repo: flags.include_repo,
    include_readme: flags.include_readme,
    include_commits: flags.include_commits,
  };
  if (!selection.allRepos) {
    connector_specific_config.repositories = selection.names.join(",");
  }
  return {
    name: input.name,
    source: "bitbucket",
    input_type: "poll",
    access_type: "public",
    groups: [],
    refresh_freq: refresh,
    ...(input.indexingStart ? { indexing_start: input.indexingStart } : {}),
    connector_specific_config,
  };
}

function bitbucketPlan(input: WizardCreateInput, refresh: number): StafflessCreatePlan {
  const email = input.credentials.email?.trim();
  const token = input.credentials.token?.trim();
  if (!email || !token) {
    throw new Error("Bitbucket needs email, API token, and at least one repository");
  }
  return {
    credential: {
      name: `${input.name} credentials`,
      source: "bitbucket",
      admin_public: true,
      credential_json: { bitbucket_email: email, bitbucket_api_token: token },
    },
    connector: bitbucketConnector(input, refresh),
  };
}

function slackConnector(input: WizardConnectorInput, refresh: number): StafflessCreatePlan["connector"] {
  const channels = parseSlackChannelNames(input.config?.channels);
  if (channels.length === 0) {
    throw new Error("Slack needs a bot token and at least one channel");
  }
  const types = dataTypeList(input.config);
  return {
    name: input.name,
    source: "slack",
    input_type: "poll",
    access_type: "public",
    groups: [],
    refresh_freq: refresh,
    ...(input.indexingStart ? { indexing_start: input.indexingStart } : {}),
    connector_specific_config: {
      channels,
      include_bot_messages: types != null && types.includes("bot_messages"),
    },
  };
}

function slackPlan(input: WizardCreateInput, refresh: number): StafflessCreatePlan {
  const token = requiredText(input.credentials.token, "Slack needs a bot token and at least one channel");
  return {
    credential: {
      name: `${input.name} credentials`,
      source: "slack",
      admin_public: true,
      credential_json: { slack_bot_token: token },
    },
    connector: slackConnector(input, refresh),
  };
}

function teamsConnector(input: WizardConnectorInput, refresh: number): StafflessCreatePlan["connector"] {
  return {
    name: input.name,
    source: "teams",
    input_type: "poll",
    access_type: "public",
    groups: [],
    refresh_freq: refresh,
    connector_specific_config: {
      teams: commaList(input.config?.teamNames),
    },
  };
}

function teamsPlan(input: WizardCreateInput, refresh: number): StafflessCreatePlan {
  const clientId = requiredText(
    input.credentials.teams_client_id,
    "Teams needs client ID, client secret, and directory ID"
  );
  const clientSecret = requiredText(
    input.credentials.teams_client_secret,
    "Teams needs client ID, client secret, and directory ID"
  );
  const directoryId = requiredText(
    input.credentials.teams_directory_id,
    "Teams needs client ID, client secret, and directory ID"
  );
  return {
    credential: {
      name: `${input.name} credentials`,
      source: "teams",
      admin_public: true,
      credential_json: {
        teams_client_id: clientId,
        teams_client_secret: clientSecret,
        teams_directory_id: directoryId,
      },
    },
    connector: teamsConnector(input, refresh),
  };
}

function imapPort(raw: unknown): number {
  if (raw == null) return IMAP_DEFAULT_PORT;
  const text = String(raw).trim();
  if (!text) return IMAP_DEFAULT_PORT;
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > IMAP_MAX_PORT) {
    throw new Error("IMAP port must be an integer between 1 and 65535");
  }
  return port;
}

function imapConnector(input: WizardConnectorInput, refresh: number): StafflessCreatePlan["connector"] {
  const host = requiredText(input.config?.host, "IMAP needs username, password, host, and at least one folder");
  const mailboxes = parseImapMailboxNames(input.config);
  if (mailboxes.length === 0) {
    throw new Error("IMAP needs username, password, host, and at least one folder");
  }
  const allowedSenders = allowedSenderValues(input.config?.allowedSenders ?? input.config?.allowed_senders);
  const connector_specific_config: Record<string, unknown> = {
    host,
    port: imapPort(input.config?.port),
    mailboxes,
  };
  if (allowedSenders.length > 0) {
    connector_specific_config.allowed_senders = allowedSenders;
  }
  return {
    name: input.name,
    source: "imap",
    input_type: "poll",
    access_type: "public",
    groups: [],
    refresh_freq: refresh,
    ...(input.indexingStart ? { indexing_start: input.indexingStart } : {}),
    connector_specific_config,
  };
}

function imapPlan(input: WizardCreateInput, refresh: number): StafflessCreatePlan {
  const username = requiredText(
    input.credentials.imap_username,
    "IMAP needs username, password, host, and at least one folder"
  );
  const password = requiredText(
    input.credentials.imap_password,
    "IMAP needs username, password, host, and at least one folder"
  );
  return {
    credential: {
      name: `${input.name} credentials`,
      source: "imap",
      admin_public: true,
      credential_json: { imap_username: username, imap_password: password },
    },
    connector: imapConnector(input, refresh),
  };
}

function s3Connector(input: WizardConnectorInput, refresh: number): StafflessCreatePlan["connector"] {
  const bucketName = requiredText(input.config?.bucket_name, "S3 needs bucket name");
  const prefix = typeof input.config?.prefix === "string" ? input.config.prefix.trim() : "";
  return {
    name: input.name,
    source: "s3",
    input_type: "poll",
    access_type: "public",
    groups: [],
    refresh_freq: refresh,
    connector_specific_config: {
      bucket_name: bucketName,
      bucket_type: "s3",
      prefix: prefix,
    },
  };
}

function s3Plan(input: WizardCreateInput, refresh: number): StafflessCreatePlan {
  const accessKeyId = requiredText(
    input.credentials.access_key_id,
    "S3 needs access key ID and secret access key"
  );
  const secretAccessKey = requiredText(
    input.credentials.secret_access_key,
    "S3 needs access key ID and secret access key"
  );
  return {
    credential: {
      name: `${input.name} credentials`,
      source: "s3",
      admin_public: true,
      credential_json: { 
        aws_access_key_id: accessKeyId, 
        aws_secret_access_key: secretAccessKey 
      },
    },
    connector: s3Connector(input, refresh),
  };
}
