import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchTeams, parseTeamNames, TeamsListError } from "./fetch-teams";

const CLIENT = "11111111-1111-1111-1111-111111111111";
const TENANT = "22222222-2222-2222-2222-222222222222";
const SECRET = "super-secret-value";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseTeamNames", () => {
  it("keeps an array and a comma string as unique display names", () => {
    assert.deepEqual(parseTeamNames([" Support ", "Engineering", "Support"]), ["Support", "Engineering"]);
    assert.deepEqual(parseTeamNames(" Support, Engineering , "), ["Support", "Engineering"]);
  });

  it("returns nothing for a blank value", () => {
    assert.deepEqual(parseTeamNames(""), []);
    assert.deepEqual(parseTeamNames(undefined), []);
  });
});

describe("fetchTeams", () => {
  it("lists active teams, skips expired ones, and follows a Graph next page", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/oauth2/v2.0/token")) {
        return jsonResponse(200, { access_token: "token-not-the-secret" });
      }
      if (!url.includes("$skiptoken")) {
        return jsonResponse(200, {
          value: [
            { id: "a", displayName: "Support" },
            { id: "b", displayName: "Old", expirationDateTime: "2020-01-01T00:00:00Z" },
            { id: "c", displayName: "" },
          ],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/teams?$skiptoken=page2",
        });
      }
      return jsonResponse(200, {
        value: [
          { id: "d", displayName: "Engineering" },
          { id: "e", displayName: "Support" },
        ],
      });
    };

    const teams = await fetchTeams(CLIENT, SECRET, TENANT, fetchImpl);
    assert.deepEqual(
      teams.map((team) => team.fullName),
      ["Engineering", "Support"]
    );
    assert.equal(teams.find((team) => team.fullName === "Support")?.detail, "2 teams share this name — all of them will be indexed");
    assert.equal(calls.some((url) => url.includes(SECRET)), false);
    assert.equal(JSON.stringify(teams).includes(SECRET), false);
  });

  it("refuses a next page that leaves Microsoft Graph", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/oauth2/v2.0/token")) return jsonResponse(200, { access_token: "tok" });
      return jsonResponse(200, {
        value: [{ id: "a", displayName: "Support" }],
        "@odata.nextLink": "https://evil.example/v1.0/teams",
      });
    };
    await assert.rejects(
      () => fetchTeams(CLIENT, SECRET, TENANT, fetchImpl),
      (err: unknown) => err instanceof TeamsListError && err.message.includes("unexpected page link") && !err.message.includes(SECRET)
    );
  });

  it("does not echo the client secret when Microsoft rejects the app", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse(401, { error: SECRET });
    await assert.rejects(
      () => fetchTeams(CLIENT, SECRET, TENANT, fetchImpl),
      (err: unknown) =>
        err instanceof TeamsListError && err.status === 401 && err.message === "Microsoft rejected the app credentials."
    );
  });
});
