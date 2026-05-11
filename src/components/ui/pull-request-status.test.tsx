import { describe, expect, it } from "bun:test";
import {
  PullRequestBadgeStatus,
  type PullRequestSummary,
} from "../../types/github";
import { getPullRequestStatus } from "./pull-request-status";

const NEUTRAL_STATUS_CLASS = "border-ink-300 bg-surface text-ink-600";
const SUCCESS_STATUS_CLASS =
  "border-[#BFE1CC] bg-[#EAF6EF] text-[#1C6B3A] dark:border-green-900/30 dark:bg-green-950/40 dark:text-green-300";
const CONFLICT_STATUS_CLASS =
  "border-[#F1C9C9] bg-[#FBEAEA] text-danger-600 dark:border-red-900/30 dark:bg-red-950/40 dark:text-red-300";

function makePullRequest(
  overrides: Partial<PullRequestSummary> = {},
): PullRequestSummary {
  return {
    number: 1,
    title: "Improve PR status",
    state: "OPEN",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    mergeable: "UNKNOWN",
    additions: 10,
    deletions: 2,
    authorLogin: "octocat",
    updatedAt: "2026-05-11T00:00:00Z",
    url: "https://github.com/outerworld/rudu/pull/1",
    headSha: "head-sha",
    baseSha: "base-sha",
    ...overrides,
  };
}

describe("getPullRequestStatus", () => {
  it.each([
    {
      name: "merged",
      pullRequest: makePullRequest({ state: "MERGED" }),
      expected: {
        status: PullRequestBadgeStatus.Merged,
        label: "Merged",
        className: SUCCESS_STATUS_CLASS,
      },
    },
    {
      name: "closed",
      pullRequest: makePullRequest({ state: "CLOSED" }),
      expected: {
        status: PullRequestBadgeStatus.Closed,
        label: "Closed",
        className: NEUTRAL_STATUS_CLASS,
      },
    },
    {
      name: "draft",
      pullRequest: makePullRequest({ isDraft: true }),
      expected: {
        status: PullRequestBadgeStatus.Draft,
        label: "Draft",
        className: NEUTRAL_STATUS_CLASS,
      },
    },
    {
      name: "conflicting by mergeable",
      pullRequest: makePullRequest({ mergeable: "CONFLICTING" }),
      expected: {
        status: PullRequestBadgeStatus.Conflicting,
        label: "Conflicting",
        className: CONFLICT_STATUS_CLASS,
      },
    },
    {
      name: "conflicting by merge state",
      pullRequest: makePullRequest({ mergeStateStatus: "DIRTY" }),
      expected: {
        status: PullRequestBadgeStatus.Conflicting,
        label: "Conflicting",
        className: CONFLICT_STATUS_CLASS,
      },
    },
    {
      name: "can merge",
      pullRequest: makePullRequest({ mergeable: "MERGEABLE" }),
      expected: {
        status: PullRequestBadgeStatus.CanMerge,
        label: "Can Merge",
        className: SUCCESS_STATUS_CLASS,
      },
    },
    {
      name: "open fallback",
      pullRequest: makePullRequest(),
      expected: {
        status: PullRequestBadgeStatus.Open,
        label: "Open",
        className: NEUTRAL_STATUS_CLASS,
      },
    },
  ])("classifies $name pull requests", ({ pullRequest, expected }) => {
    expect(getPullRequestStatus(pullRequest)).toEqual(expected);
  });
});
