import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CatalogCreateError, planCatalogCreate } from "./plan-create";

describe("planCatalogCreate", () => {
  it("builds Slack credential and channel list", () => {
    const plan = planCatalogCreate({
      name: "Support Slack",
      source: "slack",
      credentials: { slack_bot_token: "xoxb-example" },
      config: { channels: "support\neng" },
      pollInterval: 15,
    });
    assert.equal(plan.credential.source, "slack");
    assert.equal(plan.credential.credential_json.slack_bot_token, "xoxb-example");
    assert.deepEqual(plan.connector.connector_specific_config.channels, ["support", "eng"]);
    assert.equal(plan.connector.input_type, "poll");
    assert.equal(plan.connector.refresh_freq, 900);
  });

  it("builds Notion token and optional root page", () => {
    const plan = planCatalogCreate({
      name: "Notion",
      source: "notion",
      credentials: { notion_integration_token: "ntn_example" },
      config: { root_page_id: "abc" },
    });
    assert.equal(plan.credential.credential_json.notion_integration_token, "ntn_example");
    assert.equal(plan.connector.connector_specific_config.root_page_id, "abc");
  });

  it("builds Confluence token fields", () => {
    const plan = planCatalogCreate({
      name: "Wiki",
      source: "confluence",
      credentials: { confluence_username: "a@b.com", confluence_access_token: "tok" },
      config: { wiki_base: "https://ex.atlassian.net/wiki", is_cloud: true, space: "KB" },
    });
    assert.equal(plan.connector.connector_specific_config.wiki_base, "https://ex.atlassian.net/wiki");
    assert.equal(plan.connector.connector_specific_config.space, "KB");
    assert.equal(plan.connector.connector_specific_config.is_cloud, true);
  });

  it("sends Bitbucket include flags to the engine", () => {
    const plan = planCatalogCreate({
      name: "BB",
      source: "bitbucket",
      credentials: { bitbucket_email: "a@b.com", bitbucket_api_token: "tok" },
      config: {
        workspace: "acme",
        include_prs: true,
        include_repo: true,
        include_readme: true,
        include_commits: false,
      },
    });
    const cfg = plan.connector.connector_specific_config;
    assert.equal(cfg.workspace, "acme");
    assert.equal(cfg.include_prs, true);
    assert.equal(cfg.include_repo, true);
    assert.equal(cfg.include_readme, true);
    assert.equal(cfg.include_commits, false);
  });

  it("sends bucket_type for blob sources (S3/R2/GCS/OCI)", () => {
    const cases: Array<{ source: string; bucket_type: string }> = [
      { source: "s3", bucket_type: "s3" },
      { source: "r2", bucket_type: "r2" },
      { source: "google_cloud_storage", bucket_type: "google_cloud_storage" },
      { source: "oci_storage", bucket_type: "oci_storage" },
    ];
    for (const { source, bucket_type } of cases) {
      const plan = planCatalogCreate({
        name: "Blobs",
        source,
        credentials:
          source === "r2"
            ? { account_id: "acct", r2_access_key_id: "k", r2_secret_access_key: "s" }
            : source === "oci_storage"
              ? { namespace: "ns", region: "r", access_key_id: "k", secret_access_key: "s" }
              : source === "s3"
                ? { aws_access_key_id: "k", aws_secret_access_key: "s" }
                : { access_key_id: "k", secret_access_key: "s" },
        config: { bucket_name: "bkt" },
      });
      assert.equal(plan.connector.connector_specific_config.bucket_type, bucket_type);
      assert.equal(plan.connector.connector_specific_config.bucket_name, "bkt");
    }
  });

  it("rejects a caller-supplied bucket_type override", () => {
    assert.throws(
      () =>
        planCatalogCreate({
          name: "S3",
          source: "s3",
          credentials: { aws_access_key_id: "k", aws_secret_access_key: "s" },
          config: { bucket_name: "bkt", bucket_type: "r2" },
        }),
      CatalogCreateError
    );
  });

  it("rejects unknown extra credential keys", () => {
    assert.throws(
      () =>
        planCatalogCreate({
          name: "Slack",
          source: "slack",
          credentials: { slack_bot_token: "x", extra: "nope" },
        }),
      CatalogCreateError
    );
  });

  it("rejects XenForo and OAuth-only sources", () => {
    assert.throws(
      () => planCatalogCreate({ name: "XF", source: "xenforo", config: { base_url: "https://forum.example" } }),
      /cannot be added yet/
    );
    assert.throws(
      () =>
        planCatalogCreate({
          name: "Mail",
          source: "gmail",
          credentials: { google_tokens: "tok" },
        }),
      /cannot be added yet/
    );
  });

  it("rejects catalog Teams create so an empty config cannot index every team", () => {
    assert.throws(
      () =>
        planCatalogCreate({
          name: "Teams RD",
          source: "teams",
          credentials: {
            teams_client_id: "id",
            teams_client_secret: "secret",
            teams_directory_id: "tid",
          },
        }),
      /connector wizard/
    );
  });

  it("rejects unknown source and empty name", () => {
    assert.throws(() => planCatalogCreate({ name: "X", source: "not_a_source" }), /Unknown connector source/);
    assert.throws(() => planCatalogCreate({ name: "  ", source: "slack" }), /Name is required/);
  });
});
