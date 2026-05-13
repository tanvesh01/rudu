import { describe, expect, it } from "bun:test";
import type {
  PullRequestChecks,
  PullRequestOverview,
} from "../../types/github";
import {
  CHECKS_POLL_INTERVAL_MS,
  getPullRequestChecksRefetchInterval,
  getPullRequestDetailsPanelState,
  hasPendingChecks,
} from "./use-pull-request-details";

function makeChecks(
  overrides: Partial<PullRequestChecks> = {},
): PullRequestChecks {
  return {
    repo: "outerworld/rudu",
    number: 51,
    status: "pass",
    checks: [
      {
        title: "build",
        status: "pass",
        logoUrl: null,
        isTerminal: true,
        startedAt: null,
        completedAt: null,
        createdAt: null,
        order: 0,
      },
    ],
    ...overrides,
  };
}

function makeOverview(): PullRequestOverview {
  return {
    repo: "outerworld/rudu",
    number: 51,
    title: "Deepen PR details",
    body: "Move details lifecycle out of the patch viewer.",
    state: "OPEN",
    isDraft: false,
    url: "https://github.com/outerworld/rudu/pull/51",
    updatedAt: "2026-05-11T00:00:00Z",
    authorLogin: "octocat",
    authorAvatarUrl: null,
  };
}

describe("pull request details state", () => {
  it("polls checks only while aggregate or individual checks are pending", () => {
    const pendingAggregate = makeChecks({ status: "pending" });
    const pendingCheck = makeChecks({
      checks: [
        {
          ...makeChecks().checks[0],
          status: "pending",
          isTerminal: false,
        },
      ],
    });
    const passingChecks = makeChecks();

    expect(hasPendingChecks(pendingAggregate)).toBe(true);
    expect(hasPendingChecks(pendingCheck)).toBe(true);
    expect(hasPendingChecks(passingChecks)).toBe(false);
    expect(getPullRequestChecksRefetchInterval(pendingCheck)).toBe(
      CHECKS_POLL_INTERVAL_MS,
    );
    expect(getPullRequestChecksRefetchInterval(passingChecks)).toBe(false);
  });

  it("keeps cached checks visible during manual refresh", () => {
    let didRefresh = false;
    const overview = makeOverview();
    const checks = makeChecks();
    const state = getPullRequestDetailsPanelState({
      overview,
      checks,
      isOverviewPending: false,
      isOverviewFetching: false,
      isChecksPending: false,
      isChecksFetching: true,
      overviewError: null,
      checksError: null,
      refetchChecks: () => {
        didRefresh = true;
      },
    });

    expect(state.overview).toBe(overview);
    expect(state.checks).toBe(checks);
    expect(state.isChecksLoading).toBe(false);
    expect(state.isChecksRefreshing).toBe(true);

    state.onRefreshChecks();

    expect(didRefresh).toBe(true);
  });

  it("reports first-load checks as loading when no cached data exists", () => {
    const state = getPullRequestDetailsPanelState({
      overview: undefined,
      checks: undefined,
      isOverviewPending: true,
      isOverviewFetching: true,
      isChecksPending: true,
      isChecksFetching: true,
      overviewError: new Error("overview failed"),
      checksError: "checks failed",
      refetchChecks: () => {},
    });

    expect(state.overview).toBeNull();
    expect(state.checks).toBeNull();
    expect(state.isOverviewLoading).toBe(true);
    expect(state.isChecksLoading).toBe(true);
    expect(state.overviewError).toBe("overview failed");
    expect(state.checksError).toBe("checks failed");
  });
});
