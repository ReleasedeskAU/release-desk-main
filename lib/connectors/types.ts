export type ConnectorTypeId = "jira" | "github" | "gitlab" | "bitbucket" | "teams" | "imap" | "slack" | "s3";

export interface ConnectorFieldDef {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "select";
  placeholder?: string;
  optional?: boolean;
  help?: string;
  options?: string[];
}

export interface ConnectorTypeDef {
  id: ConnectorTypeId;
  label: string;
  authType: "api_key" | "oauth2" | "basic_token";
  available: boolean;
  defaultPollInterval: number;
  /** Shown in the wizard so customers know how to obtain credentials. */
  setupHint?: string;
  credentialFields: ConnectorFieldDef[];
  configFields: ConnectorFieldDef[];
  targetModel: "WorkItem" | "P1Issue";
}

export const CONNECTOR_TYPES: ConnectorTypeDef[] = [
  {
    id: "jira",
    label: "Jira",
    authType: "basic_token",
    available: true,
    defaultPollInterval: 15,
    setupHint:
      "Email must be the Atlassian account that created this API token (the address you use to sign in to Jira). Check fields verifies the site URL, that email, and the token with Jira. A wrong URL, email, or token cannot continue. Next we load the live project list.",
    credentialFields: [
      {
        key: "email",
        label: "Atlassian account email",
        type: "text",
        placeholder: "you@company.com",
        help: "The Atlassian account that created this API token — not a teammate’s email and not the Jira site URL.",
      },
      {
        key: "apiToken",
        label: "API Token",
        type: "password",
        help: "Create this under that same Atlassian account (Profile → Security → API tokens). Never pasted into Ask or logs.",
      },
    ],
    configFields: [],
    targetModel: "WorkItem",
  },
  {
    id: "github",
    label: "GitHub",
    authType: "api_key",
    available: true,
    defaultPollInterval: 15,
    setupHint:
      "Use a GitHub personal access token with repo access (classic: repo or public_repo; fine-grained: Contents: Read). Check fields verifies the token with GitHub. Invalid, revoked, or no-permission tokens are rejected here.",
    credentialFields: [
      {
        key: "token",
        label: "Personal Access Token",
        type: "password",
        help: "Classic needs repo or public_repo. Fine-grained needs Contents: Read. Never pasted into Ask or logs.",
      },
    ],
    configFields: [],
    targetModel: "WorkItem",
  },
  {
    id: "gitlab",
    label: "GitLab",
    authType: "api_key",
    available: true,
    defaultPollInterval: 15,
    setupHint:
      "Use a GitLab personal access token with read_api (or api). Check fields verifies the site URL and token with GitLab. Next we load the live project list so you can pick one or more projects.",
    credentialFields: [
      {
        key: "token",
        label: "Access token",
        type: "password",
        help: "GitLab personal access token (glpat-…). Needs read_api. Never pasted into Ask or logs.",
      },
    ],
    configFields: [],
    targetModel: "WorkItem",
  },
  {
    id: "bitbucket",
    label: "Bitbucket",
    authType: "basic_token",
    available: true,
    defaultPollInterval: 15,
    setupHint:
      "Use the Atlassian account email that created this API token, plus the token — not a Bitbucket username. Check fields verifies them with Bitbucket. A username, wrong email, or wrong token cannot continue. Next we load the live repository list so you can pick one or more repos.",
    credentialFields: [
      {
        key: "email",
        label: "Atlassian account email",
        type: "text",
        placeholder: "you@company.com",
        help: "The Atlassian account that created this API token — not the Bitbucket username.",
      },
      {
        key: "token",
        label: "API token",
        type: "password",
        help: "Bitbucket Cloud API token. Never pasted into Ask or logs.",
      },
    ],
    configFields: [],
    targetModel: "WorkItem",
  },
  {
    id: "teams",
    label: "Microsoft Teams",
    authType: "api_key",
    available: true,
    defaultPollInterval: 15,
    setupHint:
      "Register an Azure AD (Microsoft Entra ID) app and grant Microsoft Graph application permission Team.ReadBasic.All (plus channel and message read) with admin consent. Enter the Application (client) ID, Directory (tenant) ID, and a client secret. The next step loads the teams this app can access — pick at least one. There is no OAuth click-through and no whole-tenant option.",
    credentialFields: [
      {
        key: "teams_client_id",
        label: "Application (client) ID",
        type: "text",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      },
      { key: "teams_client_secret", label: "Client secret", type: "password" },
      {
        key: "teams_directory_id",
        label: "Directory (tenant) ID",
        type: "text",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      },
    ],
    configFields: [],
    targetModel: "WorkItem",
  },
  {
    id: "imap",
    label: "Email (IMAP)",
    authType: "basic_token",
    available: true,
    defaultPollInterval: 15,
    setupHint:
      "This is IMAP, not Outlook or Microsoft Graph. Use a shared mailbox when you can (for example releases@company.com). Many Microsoft 365 organizations block basic IMAP login. After this step we load the live folder list — you must pick folders; there is no whole-inbox option.",
    credentialFields: [
      {
        key: "imap_username",
        label: "IMAP username",
        type: "text",
        placeholder: "you@company.com",
      },
      { key: "imap_password", label: "IMAP password", type: "password" },
    ],
    configFields: [
      {
        key: "host",
        label: "IMAP host",
        type: "text",
        placeholder: "outlook.office365.com",
        help: "Hostname only (for example outlook.office365.com or imap.gmail.com).",
      },
      {
        key: "port",
        label: "Port",
        type: "text",
        placeholder: "993",
        optional: true,
        help: "Defaults to 993 (IMAPS) when left blank.",
      },
    ],
    targetModel: "WorkItem",
  },
  {
    id: "slack",
    label: "Slack",
    authType: "api_key",
    available: true,
    defaultPollInterval: 15,
    setupHint:
      "Use a Slack bot token (xoxb-). Check fields verifies it with Slack. Invalid or revoked tokens cannot continue. Next we load channels the bot is already in — invite the bot first. You must pick at least one channel. Reading messages also needs channels:history (and groups:history for private channels); reinstall the app after adding scopes.",
    credentialFields: [
      {
        key: "token",
        label: "Bot token",
        type: "password",
    help: "Slack bot token (xoxb-). Needs channels:read, channels:history, and users:read. Private channels also need groups:read, groups:history, and an invite. Reinstall the app after changing scopes, then paste the new token. Never pasted into Ask or logs.",
      },
    ],
    configFields: [],
    targetModel: "WorkItem",
  },
  {
    id: "s3",
    label: "Amazon S3",
    authType: "api_key",
    available: true,
    defaultPollInterval: 15,
    setupHint:
      "Use an IAM access key with s3:ListBucket and s3:GetObject on this bucket. Check fields validates the shape; the next step browses the live bucket so you can pick folders — you must pick at least one, there is no whole-bucket option.",
    credentialFields: [
      {
        key: "access_key_id",
        label: "Access key ID",
        type: "text",
        placeholder: "AKIA…",
      },
      {
        key: "secret_access_key",
        label: "Secret access key",
        type: "password",
        help: "Never pasted into Ask or logs.",
      },
    ],
    configFields: [
      {
        key: "bucket_name",
        label: "Bucket name",
        type: "text",
        placeholder: "company-releases",
        help: "Exact bucket name (no s3:// prefix, no slashes).",
      },
      {
        key: "prefix",
        label: "Folder prefix",
        type: "text",
        placeholder: "releases/frontend/",
        optional: true,
        help: "Managed by the folder browser on the next step — leave this to the browser.",
      },
    ],
    targetModel: "WorkItem",
  },
];

export const POLL_INTERVAL_OPTIONS = [
  { value: 5, label: "Every 5 minutes" },
  { value: 15, label: "Every 15 minutes" },
  { value: 30, label: "Every 30 minutes" },
  { value: 60, label: "Hourly" },
];

export function getConnectorTypeDef(type: string): ConnectorTypeDef | undefined {
  return CONNECTOR_TYPES.find((t) => t.id === type);
}

export function statusBadge(status: string, enabled: boolean): { label: string; color: string; emoji: string } {
  if (status === "DELETING") {
    return { label: "Deleting", color: "bg-orange-100 text-orange-800", emoji: "🟠" };
  }
  if (!enabled || status === "DISABLED") {
    return { label: "Paused", color: "bg-gray-100 text-gray-600", emoji: "⚪" };
  }
  switch (status) {
    case "CONNECTED":
      return { label: "Connected", color: "bg-green-100 text-green-800", emoji: "🟢" };
    case "ERROR":
      return { label: "Error", color: "bg-red-100 text-red-800", emoji: "🔴" };
    case "PENDING":
      return { label: "Pending", color: "bg-yellow-100 text-yellow-800", emoji: "🟡" };
    default:
      return { label: status, color: "bg-gray-100 text-gray-600", emoji: "⚪" };
  }
}
