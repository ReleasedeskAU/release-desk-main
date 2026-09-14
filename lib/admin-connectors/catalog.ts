/**
 * 54 engine sources for Admin Connectors.
 * Credential and config field names match the index engine.
 */

import type { AdminConnectorSource, CatalogField, ComingSoonReason, SourceCategory } from "./types";

function text(name: string, label: string, extra: Partial<CatalogField> = {}): CatalogField {
  return { type: "text", name, label, ...extra };
}

function password(name: string, label: string, extra: Partial<CatalogField> = {}): CatalogField {
  return { type: "password", name, label, secret: true, ...extra };
}

function num(name: string, label: string, extra: Partial<CatalogField> = {}): CatalogField {
  return { type: "number", name, label, optional: true, ...extra };
}

function check(name: string, label: string, extra: Partial<CatalogField> = {}): CatalogField {
  return { type: "checkbox", name, label, optional: true, ...extra };
}

function list(name: string, label: string, extra: Partial<CatalogField> = {}): CatalogField {
  return { type: "list", name, label, optional: true, ...extra };
}

function select(
  name: string,
  label: string,
  options: { value: string; label: string }[],
  extra: Partial<CatalogField> = {}
): CatalogField {
  return { type: "select", name, label, options, ...extra };
}

function src(
  id: string,
  label: string,
  category: SourceCategory,
  credentialFields: CatalogField[],
  configFields: CatalogField[],
  extra: { inputType?: "poll" | "load_state"; comingSoon?: ComingSoonReason } = {}
): AdminConnectorSource {
  return {
    id,
    label,
    category,
    inputType: extra.inputType ?? "poll",
    comingSoon: extra.comingSoon,
    credentialFields,
    configFields,
  };
}

export const ADMIN_CONNECTOR_SOURCES: AdminConnectorSource[] = [
  src("web", "Web", "other", [], [
    text("base_url", "Base URL"),
    select("web_connector_type", "Scrape method", [
      { value: "recursive", label: "Recursive" },
      { value: "single", label: "Single page" },
      { value: "sitemap", label: "Sitemap" },
    ]),
    check("scroll_before_scraping", "Scroll before scraping"),
  ], { inputType: "load_state" }),

  src("lumapps", "LumApps", "wiki", [
    text("lumapps_application_id", "Application ID"),
    password("lumapps_api_key", "API key"),
    text("lumapps_service_user", "Service user email"),
  ], [
    text("base_url", "API base URL"),
    text("organization_id", "Organization ID"),
    list("instance_ids", "Instance IDs", { help: "Leave empty to index every site the service user can see." }),
    list("custom_content_types", "Custom content type IDs"),
  ]),

  src("github", "GitHub", "code", [
    password("github_access_token", "Access token"),
    text("github_base_url", "GitHub Enterprise URL", {
      optional: true,
      help: "Leave blank for github.com.",
    }),
  ], [
    text("repo_owner", "Owner (user or organization)"),
    text("repositories", "Repository names", {
      optional: true,
      help: "Comma-separated. Leave empty to index every repository this token can see.",
    }),
    check("include_prs", "Include pull requests", { default: true }),
    check("include_issues", "Include issues"),
    check("include_files", "Include documents"),
    text("branch", "Branch for documents", { optional: true }),
  ]),

  src("testrail", "TestRail", "ticketing", [
    text("testrail_base_url", "Base URL"),
    text("testrail_username", "Username or email"),
    password("testrail_api_key", "API key"),
  ], [
    text("project_ids", "Project IDs", { optional: true, help: "Comma-separated. Leave empty for every project." }),
    num("cases_page_size", "Cases page size"),
  ]),

  src("gitlab", "GitLab", "code", [
    text("gitlab_url", "GitLab URL"),
    password("gitlab_access_token", "Access token"),
  ], [
    text("project_owner", "Project owner"),
    text("project_name", "Project name"),
    check("include_mrs", "Include merge requests", { default: true }),
    check("include_issues", "Include issues", { default: true }),
  ]),

  src("bitbucket", "Bitbucket", "code", [
    text("bitbucket_email", "Email", {
      help: "Atlassian account email for this token — not the Bitbucket username.",
    }),
    password("bitbucket_api_token", "API token"),
  ], [
    text("workspace", "Workspace", {
      help: "Slug from the repo URL (acme in bitbucket.org/acme/app), not the Bitbucket username.",
    }),
    text("repositories", "Repository slugs", {
      optional: true,
      help: "Comma-separated slugs (app). Leave empty to use projects or the whole workspace.",
    }),
    text("projects", "Project keys", { optional: true, help: "Comma-separated." }),
    check("include_prs", "Include pull requests", {
      default: true,
      passToEngine: false,
      help: "Shown for planning. The running index engine only stores workspace and repo scope.",
    }),
    check("include_repo", "Include repository details", {
      default: true,
      passToEngine: false,
      help: "Shown for planning. Restart the index engine to index repo details.",
    }),
    check("include_readme", "Include README", {
      default: true,
      passToEngine: false,
      help: "Shown for planning. Restart the index engine to index README.",
    }),
    check("include_commits", "Include commits", {
      default: true,
      passToEngine: false,
      help: "Shown for planning. Restart the index engine to index commit messages.",
    }),
  ]),

  src("gitbook", "GitBook", "wiki", [
    password("gitbook_api_key", "API key"),
  ], [text("space_id", "Space ID")]),

  src("google_drive", "Google Drive", "storage", [
    password("google_tokens", "Google tokens"),
  ], [], { comingSoon: "oauth" }),

  src("gmail", "Gmail", "messaging", [
    password("google_tokens", "Google tokens"),
  ], [], { comingSoon: "oauth" }),

  src("bookstack", "BookStack", "wiki", [
    text("bookstack_base_url", "Base URL"),
    text("bookstack_api_token_id", "Token ID"),
    password("bookstack_api_token_secret", "Token secret"),
  ], []),

  src("outline", "Outline", "wiki", [
    text("outline_base_url", "Base URL"),
    password("outline_api_token", "API token"),
  ], []),

  src("confluence", "Confluence", "wiki", [
    text("confluence_username", "Username or email"),
    password("confluence_access_token", "API token"),
  ], [
    text("wiki_base", "Wiki base URL", { help: "Example: https://your-domain.atlassian.net/wiki" }),
    check("is_cloud", "Confluence Cloud", { default: true }),
    check("scoped_token", "Using a scoped token"),
    text("space", "Space key", { optional: true, help: "Leave empty to index everything the token can see." }),
    text("page_id", "Page ID", { optional: true }),
    text("cql", "CQL query", { optional: true }),
    check("index_recursively", "Include child pages", { default: true }),
    check("include_attachments", "Include attachments"),
  ]),

  src("jira", "Jira", "ticketing", [
    text("jira_user_email", "Email", { optional: true, help: "Required for Jira Cloud." }),
    password("jira_api_token", "API token"),
  ], [
    text("jira_base_url", "Jira base URL"),
    check("scoped_token", "Using a scoped token"),
    text("project_key", "Project key", { optional: true, help: "Leave empty (and leave JQL empty) to index every project." }),
    text("jql_query", "JQL query", { optional: true, help: "Do not add time filters or ORDER BY." }),
    list("comment_email_blacklist", "Comment email blacklist"),
  ]),

  src("salesforce", "Salesforce", "sales", [
    text("sf_username", "Username"),
    password("sf_password", "Password"),
    password("sf_security_token", "Security token"),
    check("is_sandbox", "Sandbox"),
  ], [
    list("requested_objects", "Object types", {
      help: "Singular names such as Account or Opportunity. Leave empty to default to Account.",
    }),
  ]),

  src("sharepoint", "SharePoint", "wiki", [
    text("sp_client_id", "Application (client) ID"),
    password("sp_client_secret", "Client secret"),
    text("sp_directory_id", "Directory (tenant) ID"),
  ], [
    list("sites", "Site URLs", { help: "Leave empty to index the whole tenant." }),
    check("include_site_documents", "Index documents", { default: true }),
  ]),

  src("teams", "Microsoft Teams", "messaging", [
    text("teams_client_id", "Application (client) ID"),
    password("teams_client_secret", "Client secret"),
    text("teams_directory_id", "Directory (tenant) ID"),
  ], [
    list("teams", "Team names", { help: "Leave empty to index every team." }),
    text("authority_host", "Authority host", { optional: true }),
    text("graph_api_host", "Graph API host", { optional: true }),
  ]),

  src("discourse", "Discourse", "wiki", [
    password("discourse_api_key", "API key"),
    text("discourse_api_username", "API username"),
  ], [
    text("base_url", "Base URL"),
    list("categories", "Category names"),
  ]),

  src("drupal_wiki", "Drupal Wiki", "wiki", [
    password("drupal_wiki_api_token", "API token"),
  ], [
    text("base_url", "Base URL"),
    list("space_ids", "Space IDs"),
    list("page_ids", "Page IDs"),
    check("include_attachments", "Include attachments"),
  ]),

  src("axero", "Axero", "wiki", [
    text("base_url", "Base URL"),
    password("axero_api_token", "API token"),
  ], [list("spaces", "Space IDs")]),

  src("productboard", "Productboard", "ticketing", [
    password("productboard_access_token", "Access token"),
  ], []),

  src("slack", "Slack", "messaging", [
    password("slack_bot_token", "Bot token"),
  ], [
    list("channels", "Channels to include", { help: "Leave empty to index every channel the bot can see." }),
    check("channel_regex_enabled", "Treat include list as regex"),
    list("exclude_channels", "Channels to exclude"),
    check("exclude_channel_regex_enabled", "Treat exclude list as regex"),
    check("include_bot_messages", "Include bot messages"),
  ]),

  src("slab", "Slab", "wiki", [
    password("slab_bot_token", "Bot token"),
  ], [text("base_url", "Team URL")]),

  src("guru", "Guru", "wiki", [
    text("guru_user", "User email"),
    password("guru_user_token", "User token"),
  ], []),

  src("gong", "Gong", "sales", [
    password("gong_access_key", "Access key"),
    password("gong_access_key_secret", "Access key secret"),
    text("gong_base_url", "API base URL", { optional: true }),
  ], [list("workspaces", "Workspaces")]),

  src("loopio", "Loopio", "sales", [
    text("loopio_subdomain", "Subdomain"),
    text("loopio_client_id", "Client ID"),
    password("loopio_client_token", "Client token"),
  ], [text("loopio_stack_name", "Stack name", { optional: true })]),

  src("file", "File upload", "other", [], [
    text("file_locations", "Files"),
  ], { inputType: "load_state", comingSoon: "upload" }),

  src("zulip", "Zulip", "messaging", [
    password("zuliprc_content", "zuliprc contents"),
  ], [
    text("realm_name", "Realm name"),
    text("realm_url", "Realm URL"),
  ]),

  src("coda", "Coda", "wiki", [
    password("coda_bearer_token", "Bearer token"),
  ], []),

  src("notion", "Notion", "wiki", [
    password("notion_integration_token", "Integration token"),
  ], [text("root_page_id", "Root page ID", { optional: true })]),

  src("hubspot", "HubSpot", "sales", [
    password("hubspot_access_token", "Access token"),
  ], [
    select("object_types", "Object types", [
      { value: "tickets", label: "Tickets" },
      { value: "companies", label: "Companies" },
      { value: "deals", label: "Deals" },
      { value: "contacts", label: "Contacts" },
    ], { optional: true }),
  ]),

  src("document360", "Document360", "wiki", [
    text("portal_id", "Portal ID"),
    password("document360_api_token", "API token"),
  ], [
    text("workspace", "Workspace name"),
    list("categories", "Category names"),
  ]),

  src("clickup", "ClickUp", "ticketing", [
    password("clickup_api_token", "API token"),
    text("clickup_team_id", "Team ID"),
  ], [
    select("connector_type", "Scope type", [
      { value: "workspace", label: "Workspace" },
      { value: "space", label: "Space" },
      { value: "folder", label: "Folder" },
      { value: "list", label: "List" },
    ]),
    list("connector_ids", "Scope IDs"),
    check("retrieve_task_comments", "Include task comments"),
  ]),

  src("google_sites", "Google Sites", "wiki", [], [
    text("base_url", "Base URL"),
    text("file_locations", "ZIP file"),
  ], { comingSoon: "upload" }),

  src("zendesk", "Zendesk", "ticketing", [
    text("zendesk_subdomain", "Subdomain"),
    text("zendesk_email", "Email"),
    password("zendesk_token", "API token"),
  ], [
    select("content_type", "Content type", [
      { value: "articles", label: "Help Center articles" },
      { value: "tickets", label: "Tickets" },
    ]),
    num("calls_per_minute", "API calls per minute"),
  ]),

  src("linear", "Linear", "ticketing", [
    password("linear_api_key", "API key"),
  ], []),

  src("box", "Box", "storage", [
    text("box_client_id", "Client ID"),
    password("box_client_secret", "Client secret"),
    text("box_enterprise_id", "Enterprise ID"),
    text("box_user_email", "User email to impersonate", { optional: true }),
  ], [
    list("folder_ids", "Folder IDs or URLs", { help: "Leave empty to start from the root." }),
    check("include_web_links", "Include web links"),
  ]),

  src("dropbox", "Dropbox", "storage", [
    password("dropbox_access_token", "Access token"),
  ], []),

  src("s3", "S3", "storage", [
    password("aws_access_key_id", "Access key ID"),
    password("aws_secret_access_key", "Secret access key"),
  ], [
    text("bucket_name", "Bucket name"),
    text("prefix", "Prefix", { optional: true }),
  ]),

  src("r2", "R2", "storage", [
    text("account_id", "Account ID"),
    password("r2_access_key_id", "Access key ID"),
    password("r2_secret_access_key", "Secret access key"),
  ], [
    text("bucket_name", "Bucket name"),
    text("prefix", "Prefix", { optional: true }),
  ]),

  src("google_cloud_storage", "Google Cloud Storage", "storage", [
    password("access_key_id", "Access key ID"),
    password("secret_access_key", "Secret access key"),
  ], [
    text("bucket_name", "Bucket name"),
    text("prefix", "Prefix", { optional: true }),
  ]),

  src("oci_storage", "Oracle Storage", "storage", [
    text("namespace", "Namespace"),
    text("region", "Region"),
    password("access_key_id", "Access key ID"),
    password("secret_access_key", "Secret access key"),
  ], [
    text("bucket_name", "Bucket name"),
    text("prefix", "Prefix", { optional: true }),
  ]),

  src("wikipedia", "Wikipedia", "wiki", [], [
    text("language_code", "Language code", { default: "en" }),
    list("categories", "Categories"),
    list("pages", "Pages"),
    num("recurse_depth", "Recursion depth", { default: 0 }),
  ]),

  src("xenforo", "XenForo", "messaging", [], [
    text("base_url", "Forum or thread URL"),
  ], { inputType: "load_state", comingSoon: "xenforo" }),

  src("asana", "Asana", "ticketing", [
    password("asana_api_token_secret", "API token"),
  ], [
    text("asana_workspace_id", "Workspace ID"),
    text("asana_project_ids", "Project IDs", { optional: true, help: "Comma-separated." }),
    text("asana_team_id", "Team ID", { optional: true }),
  ]),

  src("mediawiki", "MediaWiki", "wiki", [], [
    text("language_code", "Language code"),
    text("hostname", "Site URL"),
    list("categories", "Categories"),
    list("pages", "Pages"),
    num("recurse_depth", "Recursion depth"),
  ]),

  src("discord", "Discord", "messaging", [
    password("discord_bot_token", "Bot token"),
  ], [
    list("server_ids", "Server IDs"),
    list("channel_names", "Channel names"),
    text("start_date", "Start date (YYYY-MM-DD)", { optional: true }),
  ]),

  src("freshdesk", "Freshdesk", "ticketing", [
    text("freshdesk_domain", "Domain"),
    password("freshdesk_api_key", "API key"),
  ], []),

  src("fireflies", "Fireflies", "sales", [
    password("fireflies_api_key", "API key"),
  ], []),

  src("braintrust", "Braintrust", "other", [
    password("braintrust_api_key", "API key"),
  ], [
    text("project_name", "Project name", { optional: true }),
    num("experiment_row_lookback_days", "Experiment row lookback (days)", { default: 30 }),
  ]),

  src("canvas", "Canvas", "wiki", [
    password("canvas_access_token", "Access token"),
  ], [text("canvas_base_url", "Canvas base URL")]),

  src("egnyte", "Egnyte", "storage", [
    text("domain", "Domain"),
    password("access_token", "Access token"),
  ], [text("folder_path", "Folder path", { optional: true })]),

  src("airtable", "Airtable", "ticketing", [
    password("airtable_access_token", "Access token"),
  ], [
    text("airtable_url", "Table URL", { optional: true, help: "Leave empty to index every base this token can see." }),
    text("share_id", "Share ID", { optional: true }),
    check("treat_all_non_attachment_fields_as_metadata", "Treat non-attachment fields as metadata"),
  ], { inputType: "load_state" }),

  src("highspot", "Highspot", "sales", [
    text("highspot_url", "URL", { optional: true }),
    password("highspot_key", "Key"),
    password("highspot_secret", "Secret"),
  ], [list("spot_names", "Spot names", { help: "Leave empty to index every spot." })]),

  src("imap", "Email (IMAP)", "messaging", [
    text("imap_username", "Username"),
    password("imap_password", "Password"),
  ], [
    text("host", "IMAP host"),
    num("port", "Port", { default: 993 }),
    list("mailboxes", "Mailboxes", { help: "Leave empty to index every mailbox." }),
    list("allowed_senders", "Approved senders", { help: "Addresses or domains. Leave empty for no sender filter." }),
  ]),
];

const BY_ID = new Map(ADMIN_CONNECTOR_SOURCES.map((source) => [source.id, source]));

/**
 * Look up a catalog source by engine id.
 */
export function getAdminConnectorSource(id: string): AdminConnectorSource | null {
  return BY_ID.get(id.trim().toLowerCase()) ?? null;
}

/**
 * All catalog sources, grouped for the tile screen.
 */
export function listAdminConnectorSources(): AdminConnectorSource[] {
  return ADMIN_CONNECTOR_SOURCES;
}

/**
 * True when the catalog query is empty or matches the source label or id.
 * Contains match only — no synonym or category mapping.
 */
export function matchesCatalogSearch(source: AdminConnectorSource, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return source.label.toLowerCase().includes(needle) || source.id.toLowerCase().includes(needle);
}
