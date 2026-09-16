import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePublicGitlabOrigin, GitlabSiteError } from "./site";

describe("parsePublicGitlabOrigin", () => {
  it("accepts gitlab.com and a custom https host", () => {
    assert.equal(parsePublicGitlabOrigin("https://gitlab.com/"), "https://gitlab.com");
    assert.equal(parsePublicGitlabOrigin("https://gitlab.example.com"), "https://gitlab.example.com");
  });

  it("rejects http, credentials in the URL, and localhost", () => {
    assert.throws(() => parsePublicGitlabOrigin("http://gitlab.com"), GitlabSiteError);
    assert.throws(() => parsePublicGitlabOrigin("https://user:pass@gitlab.com"), GitlabSiteError);
    assert.throws(() => parsePublicGitlabOrigin("https://localhost"), GitlabSiteError);
    assert.throws(() => parsePublicGitlabOrigin("https://127.0.0.1"), GitlabSiteError);
  });
});
