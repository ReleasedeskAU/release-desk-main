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

  it("keeps Bitbucket include flags off the engine config", () => {
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
    assert.equal("include_prs" in cfg, false);
    assert.equal("include_repo" in cfg, false);
    assert.equal("include_readme" in cfg, false);
    assert.equal("include_commits" in cfg, false);
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

  it("rejects unknown source and empty name", () => {
    assert.throws(() => planCatalogCreate({ name: "X", source: "not_a_source" }), /Unknown connector source/);
    assert.throws(() => planCatalogCreate({ name: "  ", source: "slack" }), /Name is required/);
  });
});
