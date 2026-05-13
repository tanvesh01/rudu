import { describe, expect, it } from "bun:test";
import {
  getAddablePullRequests,
  getAddableRepos,
  getTrackedPullRequestNumbers,
  parsePullRequestLink,
} from "./useTrackedPullRequestWorkflow";
import type { PullRequestSummary, RepoSummary } from "../types/github";

function createRepo(nameWithOwner: string): RepoSummary {
  const [, name] = nameWithOwner.split("/");
  return {
    name: name ?? nameWithOwner,
    nameWithOwner,
    description: null,
    isPrivate: false,
  };
}

function createPullRequest(number: number): PullRequestSummary {
  return {
    number,
    title: `PR ${number}`,
    state: "OPEN",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    additions: number,
    deletions: number - 1,
    authorLogin: "octocat",
    updatedAt: "2026-05-14T00:00:00Z",
    url: `https://github.com/outerworld/rudu/pull/${number}`,
    headSha: `head-${number}`,
    baseSha: `base-${number}`,
  };
}

describe("useTrackedPullRequestWorkflow helpers", () => {
  it("filters already-saved repos and caps the default repo list", () => {
    const availableRepos = [
      createRepo("outerworld/rudu"),
      createRepo("outerworld/diffs"),
      createRepo("outerworld/reviews"),
      createRepo("outerworld/picker"),
      createRepo("outerworld/trees"),
      createRepo("outerworld/cache"),
      createRepo("outerworld/theme"),
    ];
    const savedRepos = [
      createRepo("outerworld/rudu"),
      createRepo("outerworld/theme"),
    ];

    expect(getAddableRepos(availableRepos, savedRepos, "")).toEqual([
      availableRepos[1],
      availableRepos[2],
      availableRepos[3],
      availableRepos[4],
      availableRepos[5],
    ]);
  });

  it("keeps the full filtered repo list once the user is searching", () => {
    const availableRepos = [
      createRepo("outerworld/rudu"),
      createRepo("outerworld/diffs"),
      createRepo("outerworld/reviews"),
    ];
    const savedRepos = [createRepo("outerworld/rudu")];

    expect(getAddableRepos(availableRepos, savedRepos, "review")).toEqual([
      availableRepos[1],
      availableRepos[2],
    ]);
  });

  it("filters already-tracked pull requests for the selected repo", () => {
    const pullRequests = [
      createPullRequest(11),
      createPullRequest(12),
      createPullRequest(13),
    ];
    const trackedNumbers = getTrackedPullRequestNumbers(
      {
        "outerworld/rudu": [createPullRequest(12)],
      },
      "outerworld/rudu",
    );

    expect(getAddablePullRequests(pullRequests, trackedNumbers)).toEqual([
      pullRequests[0],
      pullRequests[2],
    ]);
  });

  it("parses GitHub pull request links and rejects invalid inputs", () => {
    expect(
      parsePullRequestLink("github.com/outerworld/rudu/pull/42"),
    ).toEqual({
      repo: "outerworld/rudu",
      number: 42,
    });
    expect(
      parsePullRequestLink("https://www.github.com/outerworld/rudu/pull/7"),
    ).toEqual({
      repo: "outerworld/rudu",
      number: 7,
    });
    expect(parsePullRequestLink("github.com/outerworld/rudu/issues/42")).toBe(
      null,
    );
    expect(parsePullRequestLink("not-github.example/pr/42")).toBeNull();
  });
});
