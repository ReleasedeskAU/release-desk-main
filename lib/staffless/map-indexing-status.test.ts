import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  flattenIndexingStatusPayload,
  mapIndexingStatusToBadge,
  mergeCcPairsWithIndexingStatus,
  mergeConnectorsWithStatus,
} from "./map-indexing-status";

describe("mapIndexingStatusToBadge", () => {
  it("maps a successful index to CONNECTED", () => {
    const badge = mapIndexingStatusToBadge({ last_finished_status: "success", last_success: "2026-09-01T00:00:00Z" });
    assert.equal(badge.status, "CONNECTED");
    assert.equal(badge.enabled, true);
  });

  it("maps failed, paused, and deleting states", () => {
    assert.equal(mapIndexingStatusToBadge({ last_finished_status: "failed" }).status, "ERROR");
    assert.equal(mapIndexingStatusToBadge({ cc_pair_status: "PAUSED" }).status, "DISABLED");
    assert.equal(mapIndexingStatusToBadge({ cc_pair_status: "DELETING" }).status, "DELETING");
  });
});

describe("flattenIndexingStatusPayload", () => {
  it("reads nested indexing_statuses groups", () => {
    const flat = flattenIndexingStatusPayload([
      { source: "jira", indexing_statuses: [{ name: "Jira RD", source: "jira", last_status: "success" }] },
    ]);
    assert.equal(flat.length, 1);
    assert.equal(flat[0].name, "Jira RD");
  });

  it("returns empty for unexpected payloads", () => {
    assert.deepEqual(flattenIndexingStatusPayload({}), []);
    assert.deepEqual(flattenIndexingStatusPayload(null), []);
  });
});

describe("mergeCcPairsWithIndexingStatus", () => {
  it("joins by cc_pair_id and copies credential ids without credential JSON", () => {
    const rows = mergeCcPairsWithIndexingStatus(
      [
        {
          cc_pair_id: 44,
          name: "Release Desk Jira",
          connector: {
            id: 7,
            name: "Release Desk Jira",
            source: "jira",
            credential_ids: [12],
            connector_specific_config: { jira_base_url: "https://ex.atlassian.net", project_key: "RD" },
            refresh_freq: 900,
          },
          credential: { id: 12 },
        },
      ],
      [
        {
          cc_pair_id: 44,
          name: "Release Desk Jira",
          source: "jira",
          last_finished_status: "success",
          last_success: "2026-09-01T00:00:00Z",
          docs_indexed: 31,
        },
      ]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "7");
    assert.equal(rows[0].ccPairId, 44);
    assert.deepEqual(rows[0].credentialIds, [12]);
    assert.equal(rows[0].docsIndexed, 31);
    assert.equal((rows[0].config as { projectKey: string }).projectKey, "RD");
    assert.deepEqual((rows[0].config as { projectKeys: string[] }).projectKeys, ["RD"]);
    assert.equal(rows[0].indexingStart, null);
    assert.ok(!JSON.stringify(rows[0]).includes("jira_api_token"));
  });

  it("uses this pair's credential when the connector lists several", () => {
    const rows = mergeCcPairsWithIndexingStatus(
      [
        {
          cc_pair_id: 44,
          name: "Release Desk Jira",
          connector: {
            id: 7,
            name: "Release Desk Jira",
            source: "jira",
            credential_ids: [12, 99],
            connector_specific_config: {},
          },
          credential: { id: 12 },
        },
      ],
      []
    );
    assert.deepEqual(rows[0].credentialIds, [12]);
  });

  it("coerces a digit-string pair credential id", () => {
    const rows = mergeCcPairsWithIndexingStatus(
      [
        {
          cc_pair_id: 2,
          name: "GH",
          connector: { id: 3, name: "GH", source: "github", credential_ids: [], connector_specific_config: {} },
          credential: { id: "8" },
        },
      ],
      []
    );
    assert.deepEqual(rows[0].credentialIds, [8]);
  });

  it("maps two-project JQL onto projectKeys without inventing extra filters", () => {
    const rows = mergeCcPairsWithIndexingStatus(
      [
        {
          cc_pair_id: 50,
          name: "Jira multi",
          connector: {
            id: 11,
            name: "Jira multi",
            source: "jira",
            credential_ids: [3],
            connector_specific_config: {
              jira_base_url: "https://ex.atlassian.net",
              jql_query: 'project in ("RD", "OPS")',
            },
            indexing_start: "2026-03-08T00:00:00.000Z",
          },
        },
      ],
      [{ cc_pair_id: 50, last_finished_status: "success", docs_indexed: 12 }]
    );
    assert.deepEqual((rows[0].config as { projectKeys: string[] }).projectKeys, ["RD", "OPS"]);
    assert.equal((rows[0].config as { projectKey?: string }).projectKey, undefined);
    assert.equal(rows[0].indexingStart, "2026-03-08T00:00:00.000Z");
  });

  it("keeps ccPairId when indexing-status is missing, and skips ingestion_api", () => {
    const rows = mergeCcPairsWithIndexingStatus(
      [
        {
          cc_pair_id: 9,
          name: "Mail",
          connector: {
            id: 3,
            name: "Mail",
            source: "imap",
            credential_ids: [2],
            connector_specific_config: { host: "imap.example.com", port: 993 },
          },
        },
        {
          cc_pair_id: 1,
          name: "Default",
          connector: { id: 99, name: "Ingestion", source: "ingestion_api", credential_ids: [1] },
        },
      ],
      []
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ccPairId, 9);
    assert.equal(rows[0].status, "PENDING");
  });

  it("maps an S3 bucket and prefix onto the wizard config", () => {
    const rows = mergeCcPairsWithIndexingStatus(
      [
        {
          cc_pair_id: 4,
          name: "Files",
          connector: {
            id: 11,
            name: "Files",
            source: "s3",
            credential_ids: [3],
            connector_specific_config: { bucket_name: "releases", bucket_type: "s3", prefix: "docs/" },
          },
        },
      ],
      []
    );
    assert.equal(rows[0].config?.bucket_name, "releases");
    assert.equal(rows[0].config?.prefix, "docs/");
    assert.equal(JSON.stringify(rows[0]).includes("aws_secret"), false);
  });

  it("maps GitHub include flags onto wizard dataTypes", () => {
    const rows = mergeCcPairsWithIndexingStatus(
      [
        {
          cc_pair_id: 5,
          name: "GH",
          connector: {
            id: 8,
            name: "GH",
            source: "github",
            credential_ids: [1],
            connector_specific_config: {
              repo_owner: "acme",
              repositories: "app",
              include_prs: true,
              include_issues: false,
            },
          },
        },
      ],
      [{ cc_pair_id: 5, source: "github", last_finished_status: "success" }]
    );
    assert.deepEqual((rows[0].config as { dataTypes: string[] }).dataTypes, [
      "pull_requests",
      "repository_overview",
      "commits",
    ]);
    assert.equal((rows[0].config as { repo: string }).repo, "acme/app");
    assert.deepEqual((rows[0].config as { repos: string[] }).repos, ["acme/app"]);
  });

  it("maps GitHub include_files and all-repos for an owner", () => {
    const rows = mergeCcPairsWithIndexingStatus(
      [
        {
          cc_pair_id: 6,
          name: "GH files",
          connector: {
            id: 9,
            name: "GH files",
            source: "github",
            credential_ids: [1],
            connector_specific_config: {
              repo_owner: "acme",
              include_prs: false,
              include_issues: false,
              include_files: true,
              include_overview: false,
              include_commits: false,
            },
          },
        },
      ],
      [{ cc_pair_id: 6, source: "github", last_finished_status: "success" }]
    );
    assert.deepEqual((rows[0].config as { dataTypes: string[] }).dataTypes, ["files"]);
    assert.equal((rows[0].config as { allRepos: boolean }).allRepos, true);
    assert.equal((rows[0].config as { repoOwner: string }).repoOwner, "acme");
  });

  it("maps GitLab project paths and include flags onto wizard dataTypes", () => {
    const rows = mergeCcPairsWithIndexingStatus(
      [
        {
          cc_pair_id: 7,
          name: "GL",
          connector: {
            id: 11,
            name: "GL",
            source: "gitlab",
            credential_ids: [1],
            connector_specific_config: {
              project_owner: "acme",
              project_name: "app",
              projects: "acme/app,acme/api",
              include_mrs: true,
              include_issues: false,
              include_overview: true,
              include_commits: true,
            },
          },
        },
      ],
      [{ cc_pair_id: 7, source: "gitlab", last_finished_status: "success" }]
    );
    assert.deepEqual((rows[0].config as { projects: string[] }).projects, ["acme/app", "acme/api"]);
    assert.deepEqual((rows[0].config as { dataTypes: string[] }).dataTypes, [
      "pull_requests",
      "repository_overview",
      "commits",
    ]);
  });

  it("maps Bitbucket workspace repos and include flags onto wizard dataTypes", () => {
    const rows = mergeCcPairsWithIndexingStatus(
      [
        {
          cc_pair_id: 8,
          name: "BB",
          connector: {
            id: 12,
            name: "BB",
            source: "bitbucket",
            credential_ids: [1],
            connector_specific_config: {
              workspace: "acme",
              repositories: "app",
              include_prs: true,
              include_repo: false,
              include_readme: false,
              include_commits: true,
            },
          },
        },
      ],
      [{ cc_pair_id: 8, source: "bitbucket", last_finished_status: "success" }]
    );
    assert.deepEqual((rows[0].config as { repos: string[] }).repos, ["acme/app"]);
    assert.deepEqual((rows[0].config as { dataTypes: string[] }).dataTypes, ["pull_requests", "commits"]);
    assert.equal(rows[0].authType, "basic_token");
  });

  it("maps Slack channels and bot-message flag onto wizard dataTypes", () => {
    const rows = mergeCcPairsWithIndexingStatus(
      [
        {
          cc_pair_id: 9,
          name: "Slack RD",
          connector: {
            id: 13,
            name: "Slack RD",
            source: "slack",
            credential_ids: [1],
            connector_specific_config: {
              channels: ["all-releasedesk", "social"],
              include_bot_messages: true,
            },
          },
        },
      ],
      [{ cc_pair_id: 9, source: "slack", last_finished_status: "success" }]
    );
    assert.deepEqual((rows[0].config as { channels: string[] }).channels, ["all-releasedesk", "social"]);
    assert.deepEqual((rows[0].config as { dataTypes: string[] }).dataTypes, ["threads", "bot_messages"]);
  });
});

describe("mergeConnectorsWithStatus", () => {
  it("still joins snapshots to status by name for the legacy helper", () => {
    const rows = mergeConnectorsWithStatus(
      [
        {
          id: 7,
          name: "Jira RD",
          source: "jira",
          connector_specific_config: { jira_base_url: "https://ex.atlassian.net", project_key: "RD" },
          refresh_freq: 900,
        },
      ],
      [{ name: "Jira RD", source: "jira", last_finished_status: "success", last_success: "2026-09-01T00:00:00Z" }]
    );
    assert.equal(rows[0].id, "7");
    assert.equal(rows[0].ccPairId, null);
    assert.equal(rows[0].type, "jira");
  });
});
