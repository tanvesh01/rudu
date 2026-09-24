import { describe, expect, test } from "bun:test";
import type { PullRequestInboxItem } from "../../types/github";
import {
  addRepoToPullRequests,
  filterPullRequestsByRepo,
  groupPullRequests,
} from "./pull-request-inbox";
import { ALL_REPOSITORIES } from "./repository-combobox";

function makePullRequest(
  overrides: Partial<PullRequestInboxItem>,
): PullRequestInboxItem {
  return {
    additions: 1,
    authorLogin: "viewer",
    baseSha: "base",
    deletions: 0,
    headSha: "head",
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    number: 1,
    repo: "owner/repo",
    reviewDecision: null,
    reviewRequested: false,
    state: "OPEN",
    title: "PR",
    updatedAt: "2026-08-14T00:00:00Z",
    url: "https://github.com/owner/repo/pull/1",
    ...overrides,
  };
}

describe("addRepoToPullRequests", () => {
  test("adapts a full repository result for the grouped inbox", () => {
    const { repo: _repo, reviewDecision: _decision, reviewRequested: _requested, ...pullRequest } =
      makePullRequest({ number: 12 });

    expect(addRepoToPullRequests([pullRequest], "owner/all")).toEqual([
      {
        ...pullRequest,
        repo: "owner/all",
        reviewDecision: null,
        reviewRequested: false,
      },
    ]);
  });
});

describe("filterPullRequestsByRepo", () => {
  test("filters one repository and preserves the all-repositories view", () => {
    const pullRequests = [
      makePullRequest({ number: 1, repo: "owner/one" }),
      makePullRequest({ number: 2, repo: "owner/two" }),
    ];

    expect(filterPullRequestsByRepo(pullRequests, "owner/two")).toEqual([
      pullRequests[1],
    ]);
    expect(filterPullRequestsByRepo(pullRequests, ALL_REPOSITORIES)).toBe(
      pullRequests,
    );
  });
});

describe("groupPullRequests", () => {
  test("uses inbox section precedence and groups remaining PRs by author", () => {
    const groups = groupPullRequests(
      [
        makePullRequest({ number: 1, reviewRequested: true, isDraft: true }),
        makePullRequest({ number: 2, isDraft: true }),
        makePullRequest({ number: 3, reviewDecision: "CHANGES_REQUESTED" }),
        makePullRequest({ number: 4 }),
        makePullRequest({ number: 5, authorLogin: "devin" }),
      ],
      "viewer",
    );

    expect(groups.map((group) => group.label)).toEqual([
      "Needs your review",
      "Opened by devin",
      "Waiting for reviewers",
      "Drafts",
      "Waiting for author",
    ]);
    expect(groups.map((group) => group.pullRequests[0].number)).toEqual([
      1, 5, 4, 2, 3,
    ]);
  });
});
