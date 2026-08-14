import { describe, expect, it } from "bun:test";
import { validatePullRequestListRouteSearch } from "./pull-request-list-route";

describe("pull request list route search", () => {
  it("keeps valid repository filters and drops invalid scope state", () => {
    expect(
      validatePullRequestListRouteSearch({ repo: "owner/repo", scope: "all" }),
    ).toEqual({ repo: "owner/repo", scope: "all" });
    expect(validatePullRequestListRouteSearch({ scope: "all" })).toEqual({});
    expect(
      validatePullRequestListRouteSearch({ repo: "owner/repo", scope: "nope" }),
    ).toEqual({ repo: "owner/repo" });
  });
});
