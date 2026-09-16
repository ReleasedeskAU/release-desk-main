import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requireCcPairId, requireSingleCredentialId, StafflessIdError, toPositiveStafflessId } from "./ids";
import { mapIndexAttempt, mapIndexAttemptPage, mapIndexError } from "./map-index-attempts";
import { isStafflessConnectorType, planStafflessConnector, planStafflessCreate } from "./create-payload";

describe("requireSingleCredentialId", () => {
  it("returns the only credential id", () => {
    assert.equal(requireSingleCredentialId([12]), 12);
  });

  it("refuses missing or multiple credentials", () => {
    assert.throws(() => requireSingleCredentialId([]), StafflessIdError);
    assert.throws(() => requireSingleCredentialId([1, 2]), /more than one credential/);
  });
});

describe("toPositiveStafflessId", () => {
  it("accepts digit strings and refuses junk", () => {
    assert.equal(toPositiveStafflessId(12), 12);
    assert.equal(toPositiveStafflessId("12"), 12);
    assert.equal(toPositiveStafflessId("0"), null);
    assert.equal(toPositiveStafflessId("12a"), null);
    assert.equal(toPositiveStafflessId(1.5), null);
  });
});

describe("requireCcPairId", () => {
  it("returns a positive cc-pair id", () => {
    assert.equal(requireCcPairId(44), 44);
  });

  it("refuses a missing pair instead of guessing", () => {
    assert.throws(() => requireCcPairId(null), StafflessIdError);
    assert.throws(() => requireCcPairId(0), StafflessIdError);
  });
});

describe("planStafflessConnector", () => {
  it("builds a Jira PATCH body without credentials", () => {
    const connector = planStafflessConnector({
      name: "Jira RD",
      type: "jira",
      baseUrl: "https://ex.atlassian.net/",
      config: { projectKey: "RD" },
      pollInterval: 15,
    });
    assert.equal(connector.source, "jira");
    assert.equal(connector.connector_specific_config.project_key, "RD");
    assert.ok(!JSON.stringify(connector).includes("jira_api_token"));
  });

  it("rejects types the engine cannot update", () => {
    assert.equal(isStafflessConnectorType("jenkins"), false);
    assert.throws(
      () => planStafflessConnector({ name: "Jen", type: "jenkins", config: {} }),
      /Unsupported connector type/
    );
  });
});

describe("planStafflessCreate", () => {
  it("still requires GitHub credentials on create", () => {
    const plan = planStafflessCreate({
      name: "GH RD",
      type: "github",
      credentials: { token: "ghp_example" },
      config: { repo: "acme/app", dataTypes: ["issues"] },
    });
    assert.equal(plan.credential.credential_json.github_access_token, "ghp_example");
    assert.equal(plan.connector.connector_specific_config.include_issues, true);
    assert.equal(plan.connector.connector_specific_config.include_prs, false);
    assert.equal(plan.connector.connector_specific_config.include_overview, false);
    assert.equal(plan.connector.connector_specific_config.include_commits, false);
  });
});

describe("mapIndexAttempt", () => {
  it("drops stack traces from the client payload", () => {
    const mapped = mapIndexAttempt({
      id: 9,
      status: "failed",
      from_beginning: false,
      new_docs_indexed: 0,
      total_docs_indexed: 3,
      docs_removed_from_index: 0,
      error_msg: "Index failed",
      error_count: 1,
      full_exception_trace: "Traceback (most recent call last)",
      time_started: "2026-09-01T00:00:00Z",
      time_updated: "2026-09-01T00:01:00Z",
    });
    assert.equal(mapped?.id, 9);
    assert.equal(mapped?.errorMsg, "Index failed");
    assert.ok(!JSON.stringify(mapped).includes("Traceback"));
  });

  it("skips malformed attempts", () => {
    assert.equal(mapIndexAttempt({ status: "failed" }), null);
    assert.deepEqual(mapIndexAttemptPage({ items: [{ id: 1, status: "success" }], total_items: 1 }).items.length, 1);
  });
});

describe("mapIndexError", () => {
  it("keeps the failure message and document id only", () => {
    const mapped = mapIndexError({
      id: 4,
      failure_message: "Could not fetch issue",
      is_resolved: false,
      time_created: "2026-09-01T00:00:00Z",
      document_id: "RD-1",
      extra_internal: "secret",
    });
    assert.equal(mapped?.failureMessage, "Could not fetch issue");
    assert.equal(mapped?.documentId, "RD-1");
    assert.ok(!JSON.stringify(mapped).includes("secret"));
  });
});
