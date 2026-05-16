import { describe, expect, it } from "bun:test";
import {
  DEFAULT_PULL_REQUEST_PANEL,
  getPullRequestPanelSearch,
  getPullRequestIdentityKey,
  getPullRequestRouteParams,
  getSelectedPullRequestFromPathname,
  getSelectedPullRequestFromRouteParams,
  parsePullRequestPanel,
  parsePullRequestLink,
  parsePullRequestNumber,
  validatePullRequestRouteSearch,
} from "./pull-request-route";

describe("pull request route helpers", () => {
  it("round-trips route params to a selected pull request", () => {
    const params = getPullRequestRouteParams("outerworld/rudu", 42);

    expect(params).toEqual({
      owner: "outerworld",
      repo: "rudu",
      number: "42",
    });
    expect(getSelectedPullRequestFromRouteParams(params!)).toEqual({
      repo: "outerworld/rudu",
      number: 42,
    });
  });

  it("rejects invalid pull request numbers", () => {
    expect(parsePullRequestNumber("0")).toBeNull();
    expect(parsePullRequestNumber("-1")).toBeNull();
    expect(parsePullRequestNumber("abc")).toBeNull();
    expect(
      getSelectedPullRequestFromRouteParams({
        owner: "outerworld",
        repo: "rudu",
        number: "abc",
      }),
    ).toBeNull();
  });

  it("parses selected pull requests from route pathnames", () => {
    expect(
      getSelectedPullRequestFromPathname("/repos/outerworld/rudu/pulls/7"),
    ).toEqual({
      repo: "outerworld/rudu",
      number: 7,
    });
    expect(getSelectedPullRequestFromPathname("/issues")).toBeNull();
  });

  it("parses GitHub pull request links", () => {
    expect(parsePullRequestLink("github.com/outerworld/rudu/pull/123")).toEqual(
      {
        repo: "outerworld/rudu",
        number: 123,
      },
    );
    expect(
      parsePullRequestLink("https://www.github.com/outerworld/rudu/pull/7"),
    ).toEqual({
      repo: "outerworld/rudu",
      number: 7,
    });
    expect(parsePullRequestLink("github.com/outerworld/rudu/issues/7")).toBeNull();
  });

  it("builds stable selected pull request identity keys", () => {
    expect(getPullRequestIdentityKey({ repo: "outerworld/rudu", number: 42 }))
      .toBe("outerworld/rudu#42");
    expect(getPullRequestIdentityKey(null)).toBeNull();
  });

  it("normalizes pull request panel search params", () => {
    expect(parsePullRequestPanel("pull-request")).toBe("pull-request");
    expect(parsePullRequestPanel("changed-files")).toBe(
      DEFAULT_PULL_REQUEST_PANEL,
    );
    expect(parsePullRequestPanel("unknown")).toBe(DEFAULT_PULL_REQUEST_PANEL);
    expect(getPullRequestPanelSearch("changed-files")).toEqual({});
    expect(getPullRequestPanelSearch("pull-request")).toEqual({
      panel: "pull-request",
    });
    expect(validatePullRequestRouteSearch({ panel: "pull-request" })).toEqual({
      panel: "pull-request",
    });
    expect(validatePullRequestRouteSearch({ panel: "unknown" })).toEqual({});
  });
});
