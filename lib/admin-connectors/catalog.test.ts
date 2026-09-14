import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasSourceLogo } from "@/components/admin-connectors/SourceLogo";
import { ADMIN_CONNECTOR_SOURCES, getAdminConnectorSource, matchesCatalogSearch } from "./catalog";
import { guidedConnectorType, usesGuidedOnboarding } from "./guided";
import { isCatalogSourceReady, warnsFullAccount } from "./types";

const COMING_SOON = new Set(["gmail", "google_drive", "file", "google_sites", "xenforo"]);
const FULL_ACCOUNT = new Set([
  "bookstack",
  "outline",
  "productboard",
  "guru",
  "coda",
  "linear",
  "dropbox",
  "freshdesk",
  "fireflies",
  "gmail",
  "google_drive",
]);

describe("admin connector catalog", () => {
  it("lists 54 unique sources", () => {
    const ids = ADMIN_CONNECTOR_SOURCES.map((source) => source.id);
    assert.equal(ids.length, 54);
    assert.equal(new Set(ids).size, 54);
  });

  it("marks OAuth, upload, and XenForo as coming soon", () => {
    for (const id of COMING_SOON) {
      const source = getAdminConnectorSource(id);
      assert.ok(source, id);
      assert.equal(isCatalogSourceReady(source), false);
    }
    assert.equal(getAdminConnectorSource("xenforo")?.comingSoon, "xenforo");
    assert.equal(getAdminConnectorSource("gmail")?.comingSoon, "oauth");
    assert.equal(getAdminConnectorSource("file")?.comingSoon, "upload");
  });

  it("warns when step 2 has no scope fields", () => {
    for (const source of ADMIN_CONNECTOR_SOURCES) {
      assert.equal(warnsFullAccount(source), FULL_ACCOUNT.has(source.id), source.id);
    }
  });

  it("gives every source a tile logo", () => {
    for (const source of ADMIN_CONNECTOR_SOURCES) {
      assert.equal(hasSourceLogo(source.id), true, source.id);
    }
  });

  it("filters the catalog by label or id contains", () => {
    const github = getAdminConnectorSource("github");
    const imap = getAdminConnectorSource("imap");
    assert.ok(github && imap);
    assert.equal(matchesCatalogSearch(github, ""), true);
    assert.equal(matchesCatalogSearch(github, "  GitHub  "), true);
    assert.equal(matchesCatalogSearch(github, "hub"), true);
    assert.equal(matchesCatalogSearch(github, "slack"), false);
    assert.equal(matchesCatalogSearch(imap, "imap"), true);
    assert.equal(matchesCatalogSearch(imap, "email"), true);
  });

  it("routes Jira, GitHub, Teams, and IMAP through the Connectors wizard", () => {
    for (const id of ["jira", "github", "teams", "imap"] as const) {
      assert.equal(usesGuidedOnboarding(id), true, id);
      assert.equal(guidedConnectorType(id), id);
    }
    assert.equal(usesGuidedOnboarding("slack"), false);
    assert.equal(guidedConnectorType("confluence"), null);
  });

  it("exposes Bitbucket include flags for PRs, repo, README, and commits", () => {
    const bitbucket = getAdminConnectorSource("bitbucket");
    assert.ok(bitbucket);
    const names = new Set(bitbucket.configFields.map((field) => field.name));
    assert.equal(names.has("include_prs"), true);
    assert.equal(names.has("include_repo"), true);
    assert.equal(names.has("include_readme"), true);
    assert.equal(names.has("include_commits"), true);
  });

  it("keeps Slack and GitHub ready with scope fields", () => {
    const slack = getAdminConnectorSource("slack");
    const github = getAdminConnectorSource("github");
    assert.ok(slack && github);
    assert.equal(isCatalogSourceReady(slack), true);
    assert.equal(isCatalogSourceReady(github), true);
    assert.equal(warnsFullAccount(slack), false);
    assert.equal(warnsFullAccount(github), false);
  });
});
