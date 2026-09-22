import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planStafflessCreate } from "./create-payload";

describe("planStafflessCreate", () => {
  it("builds Jira credential and connector bodies", () => {
    const plan = planStafflessCreate({
      name: "Jira RD",
      type: "jira",
      baseUrl: "https://ex.atlassian.net/",
      credentials: { email: "a@b.com", apiToken: "tok" },
      config: { projectKey: "RD" },
      pollInterval: 15,
    });
    assert.equal(plan.connector.source, "jira");
    assert.equal(plan.connector.input_type, "poll");
    assert.equal(plan.connector.refresh_freq, 900);
    assert.equal(plan.connector.connector_specific_config.project_key, "RD");
    assert.equal(plan.credential.credential_json.jira_user_email, "a@b.com");
  });

  it("uses jql_query for two Jira projects and indexing_start for a date range", () => {
    const plan = planStafflessCreate({
      name: "Jira multi",
      type: "jira",
      baseUrl: "https://ex.atlassian.net",
      credentials: { email: "a@b.com", apiToken: "tok" },
      config: { projectKeys: ["RD", "OPS"] },
      indexingStart: "2026-03-08T00:00:00.000Z",
    });
    assert.equal(plan.connector.connector_specific_config.project_key, undefined);
    assert.equal(plan.connector.connector_specific_config.jql_query, 'project in ("RD", "OPS")');
    assert.equal(plan.connector.indexing_start, "2026-03-08T00:00:00.000Z");
  });

  it("rejects Jira with neither a project selection nor all-projects", () => {
    assert.throws(
      () =>
        planStafflessCreate({
          name: "Jira RD",
          type: "jira",
          baseUrl: "https://ex.atlassian.net",
          credentials: { email: "a@b.com", apiToken: "tok" },
          config: {},
        }),
      /at least one project/
    );
  });

  it("omits project_key and jql_query when indexing every Jira project the token can see", () => {
    const plan = planStafflessCreate({
      name: "Jira all",
      type: "jira",
      baseUrl: "https://ex.atlassian.net",
      credentials: { email: "a@b.com", apiToken: "tok" },
      config: { allProjects: true },
    });
    assert.equal(plan.connector.connector_specific_config.project_key, undefined);
    assert.equal(plan.connector.connector_specific_config.jql_query, undefined);
    assert.equal(plan.connector.indexing_start, undefined);
  });

  it("builds GitHub StaffLess fields end-to-end (credential, poll, repo split, PR/issue flags)", () => {
    const plan = planStafflessCreate({
      name: "GH RD",
      type: "github",
      credentials: { token: "ghp_example" },
      config: { repo: "acme/release-desk", dataTypes: ["pull_requests"] },
      pollInterval: 15,
    });
    assert.equal(plan.credential.source, "github");
    assert.equal(plan.credential.credential_json.github_access_token, "ghp_example");
    assert.equal(plan.connector.source, "github");
    assert.equal(plan.connector.input_type, "poll");
    assert.equal(plan.connector.refresh_freq, 900);
    assert.deepEqual(plan.connector.connector_specific_config, {
      repo_owner: "acme",
      repositories: "release-desk",
      include_prs: true,
      include_issues: false,
      include_files: false,
      include_overview: false,
      include_commits: false,
    });
  });

  it("uses comma-separated repositories, include_files, and indexing_start for GitHub", () => {
    const plan = planStafflessCreate({
      name: "GH multi",
      type: "github",
      credentials: { token: "t" },
      config: { repos: ["acme/app", "acme/api"], dataTypes: ["pull_requests", "files"] },
      indexingStart: "2026-03-08T00:00:00.000Z",
    });
    assert.equal(plan.connector.connector_specific_config.repositories, "app,api");
    assert.equal(plan.connector.connector_specific_config.include_files, true);
    assert.equal(plan.connector.connector_specific_config.include_issues, false);
    assert.equal(plan.connector.indexing_start, "2026-03-08T00:00:00.000Z");
  });

  it("omits repositories when indexing every GitHub repo for one owner", () => {
    const plan = planStafflessCreate({
      name: "GH all",
      type: "github",
      credentials: { token: "t" },
      config: { allRepos: true, repoOwner: "acme", dataTypes: ["issues"] },
    });
    assert.equal(plan.connector.connector_specific_config.repo_owner, "acme");
    assert.equal(plan.connector.connector_specific_config.repositories, undefined);
    assert.equal(plan.connector.connector_specific_config.include_issues, true);
    assert.equal(plan.connector.connector_specific_config.include_prs, false);
  });

  it("defaults GitHub include_prs and include_issues when dataTypes omit both", () => {
    const plan = planStafflessCreate({
      name: "GH RD",
      type: "github",
      credentials: { token: "t" },
      config: { repo: "acme/app" },
    });
    assert.equal(plan.connector.connector_specific_config.include_prs, true);
    assert.equal(plan.connector.connector_specific_config.include_issues, true);
    assert.equal(plan.connector.connector_specific_config.include_overview, true);
    assert.equal(plan.connector.connector_specific_config.include_commits, true);
  });

  it("sends include_overview when GitHub dataTypes include repository overview", () => {
    const plan = planStafflessCreate({
      name: "GH RD",
      type: "github",
      credentials: { token: "t" },
      config: { repo: "acme/app", dataTypes: ["repository_overview"] },
    });
    assert.equal(plan.connector.connector_specific_config.include_overview, true);
    assert.equal(plan.connector.connector_specific_config.include_commits, false);
    assert.equal(plan.connector.connector_specific_config.include_prs, false);
    assert.equal(plan.connector.connector_specific_config.include_issues, false);
    assert.equal(plan.connector.connector_specific_config.include_files, false);
  });

  it("sends include_commits when GitHub dataTypes include commits", () => {
    const plan = planStafflessCreate({
      name: "GH RD",
      type: "github",
      credentials: { token: "t" },
      config: { repo: "acme/app", dataTypes: ["commits"] },
    });
    assert.equal(plan.connector.connector_specific_config.include_commits, true);
    assert.equal(plan.connector.connector_specific_config.include_prs, false);
    assert.equal(plan.connector.connector_specific_config.include_overview, false);
  });

  it("builds GitLab credential, project paths, and include flags", () => {
    const plan = planStafflessCreate({
      name: "GL RD",
      type: "gitlab",
      baseUrl: "https://gitlab.com/",
      credentials: { token: "glpat-example" },
      config: { projects: ["acme/app", "acme/api"], dataTypes: ["pull_requests", "commits"] },
      pollInterval: 15,
    });
    assert.equal(plan.credential.credential_json.gitlab_url, "https://gitlab.com");
    assert.equal(plan.credential.credential_json.gitlab_access_token, "glpat-example");
    assert.deepEqual(plan.connector.connector_specific_config, {
      project_owner: "acme",
      project_name: "app",
      projects: "acme/app,acme/api",
      include_mrs: true,
      include_issues: false,
      include_overview: false,
      include_commits: true,
      include_code_files: false,
    });
  });

  it("builds Bitbucket workspace, slugs, and include flags from dataTypes", () => {
    const plan = planStafflessCreate({
      name: "BB RD",
      type: "bitbucket",
      credentials: { email: "a@b.com", token: "tok" },
      config: { repos: ["acme/app", "acme/api"], dataTypes: ["pull_requests", "repository_overview"] },
    });
    assert.equal(plan.credential.credential_json.bitbucket_email, "a@b.com");
    assert.deepEqual(plan.connector.connector_specific_config, {
      workspace: "acme",
      repositories: "app,api",
      include_prs: true,
      include_repo: true,
      include_readme: true,
      include_commits: false,
    });
  });

  it("builds Slack channels and bot-message flag from dataTypes", () => {
    const plan = planStafflessCreate({
      name: "Ops Slack",
      type: "slack",
      credentials: { token: "xoxb-example" },
      config: { channels: ["#ops", "cab"], dataTypes: ["threads", "bot_messages"] },
      indexingStart: "2026-03-08T00:00:00.000Z",
    });
    assert.equal(plan.credential.credential_json.slack_bot_token, "xoxb-example");
    assert.deepEqual(plan.connector.connector_specific_config, {
      channels: ["ops", "cab"],
      include_bot_messages: true,
    });
    assert.equal(plan.connector.indexing_start, "2026-03-08T00:00:00.000Z");
  });

  it("rejects Slack without a channel", () => {
    assert.throws(
      () =>
        planStafflessCreate({
          name: "Ops Slack",
          type: "slack",
          credentials: { token: "xoxb-example" },
          config: { channels: [] },
        }),
      /at least one channel/
    );
  });

  it("rejects GitLab without a project and Bitbucket without a repo", () => {
    assert.throws(
      () =>
        planStafflessCreate({
          name: "GL",
          type: "gitlab",
          baseUrl: "https://gitlab.com",
          credentials: { token: "t" },
          config: {},
        }),
      /at least one project/
    );
    assert.throws(
      () =>
        planStafflessCreate({
          name: "BB",
          type: "bitbucket",
          credentials: { email: "a@b.com", token: "t" },
          config: {},
        }),
      /at least one repository/
    );
  });

  it("rejects Jenkins and incomplete GitHub repos", () => {
    assert.throws(
      () =>
        planStafflessCreate({
          name: "Jen",
          type: "jenkins",
          credentials: { username: "u", apiToken: "t" },
        }),
      /Unsupported connector type/
    );
    assert.throws(
      () =>
        planStafflessCreate({
          name: "GH",
          type: "github",
          credentials: { token: "t" },
          config: { repo: "no-slash" },
        }),
      /at least one repository/
    );
  });

  it("builds Teams credential and selected team names as a StaffLess array", () => {
    const plan = planStafflessCreate({
      name: "Teams RD",
      type: "teams",
      credentials: {
        teams_client_id: "client-id",
        teams_client_secret: "client-secret",
        teams_directory_id: "tenant-id",
      },
      config: { teams: [" Support ", "Engineering", "Support"] },
      pollInterval: 30,
    });
    assert.equal(plan.credential.source, "teams");
    assert.deepEqual(plan.credential.credential_json, {
      teams_client_id: "client-id",
      teams_client_secret: "client-secret",
      teams_directory_id: "tenant-id",
    });
    assert.equal(plan.connector.source, "teams");
    assert.equal(plan.connector.input_type, "poll");
    assert.equal(plan.connector.refresh_freq, 1800);
    assert.deepEqual(plan.connector.connector_specific_config.teams, ["Support", "Engineering"]);
  });

  it("still accepts a legacy comma-separated team name string", () => {
    const plan = planStafflessCreate({
      name: "Teams RD",
      type: "teams",
      credentials: {
        teams_client_id: "id",
        teams_client_secret: "secret",
        teams_directory_id: "tid",
      },
      config: { teamNames: " Support, Engineering , " },
    });
    assert.deepEqual(plan.connector.connector_specific_config.teams, ["Support", "Engineering"]);
  });

  it("refuses Teams when no team is selected", () => {
    assert.throws(
      () =>
        planStafflessCreate({
          name: "Teams RD",
          type: "teams",
          credentials: {
            teams_client_id: "id",
            teams_client_secret: "secret",
            teams_directory_id: "tid",
          },
        }),
      /at least one team/
    );
  });

  it("rejects Teams when any of the three Azure fields is missing", () => {
    assert.throws(
      () =>
        planStafflessCreate({
          name: "Teams RD",
          type: "teams",
          credentials: { teams_client_id: "id", teams_client_secret: "secret" },
        }),
      /Teams needs/
    );
  });

  it("builds IMAP credential, folders, allow-list, and indexing_start", () => {
    const plan = planStafflessCreate({
      name: "Mail RD",
      type: "imap",
      credentials: { imap_username: "you@company.com", imap_password: "app-pass" },
      config: {
        host: "outlook.office365.com",
        port: "993",
        mailboxes: ["INBOX", "CAB"],
        allowedSenders: "jira@company.com, company.com",
      },
      indexingStart: "2026-03-08T00:00:00.000Z",
    });
    assert.equal(plan.credential.source, "imap");
    assert.deepEqual(plan.credential.credential_json, {
      imap_username: "you@company.com",
      imap_password: "app-pass",
    });
    assert.equal(plan.connector.source, "imap");
    assert.equal(plan.connector.input_type, "poll");
    assert.equal(plan.connector.indexing_start, "2026-03-08T00:00:00.000Z");
    assert.deepEqual(plan.connector.connector_specific_config, {
      host: "outlook.office365.com",
      port: 993,
      mailboxes: ["INBOX", "CAB"],
      allowed_senders: ["jira@company.com", "company.com"],
    });
  });

  it("defaults IMAP port to 993 and rejects a missing folder list", () => {
    const plan = planStafflessCreate({
      name: "Mail RD",
      type: "imap",
      credentials: { imap_username: "u", imap_password: "p" },
      config: { host: "imap.example.com", mailboxes: ["INBOX"] },
    });
    assert.equal(plan.connector.connector_specific_config.port, 993);
    assert.deepEqual(plan.connector.connector_specific_config.mailboxes, ["INBOX"]);
    assert.equal(plan.connector.connector_specific_config.allowed_senders, undefined);
    assert.throws(
      () =>
        planStafflessCreate({
          name: "Mail RD",
          type: "imap",
          credentials: { imap_username: "u", imap_password: "p" },
          config: { host: "imap.example.com" },
        }),
      /at least one folder/
    );
  });

  it("rejects IMAP missing host and a non-integer port", () => {
    assert.throws(
      () =>
        planStafflessCreate({
          name: "Mail RD",
          type: "imap",
          credentials: { imap_username: "u", imap_password: "p" },
          config: {},
        }),
      /IMAP needs/
    );
    assert.throws(
      () =>
        planStafflessCreate({
          name: "Mail RD",
          type: "imap",
          credentials: { imap_username: "u", imap_password: "p" },
          config: { host: "imap.example.com", mailboxes: ["INBOX"], port: "imaps" },
        }),
      /IMAP port/
    );
  });

  it("does not invent an outlook StaffLess source", () => {
    assert.throws(
      () =>
        planStafflessCreate({
          name: "Outlook",
          type: "outlook",
          credentials: {},
        }),
      /Unsupported connector type/
    );
  });
});
