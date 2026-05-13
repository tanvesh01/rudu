import { useQuery } from "@tanstack/react-query";
import { getErrorMessage } from "../../hooks/useGithubQueries";
import {
  pullRequestChecksQueryOptions,
  pullRequestOverviewQueryOptions,
} from "../../queries/github";
import type {
  PullRequestChecks,
  PullRequestOverview,
  SelectedPullRequestRef,
  SelectedPullRequestRevision,
} from "../../types/github";

const CHECKS_POLL_INTERVAL_MS = 5_000;

const IDLE_PULL_REQUEST_REF: SelectedPullRequestRef = {
  repo: "__idle__",
  number: 0,
};

const IDLE_PULL_REQUEST_REVISION: SelectedPullRequestRevision = {
  repo: "__idle__",
  number: 0,
  headSha: "__idle__",
};

type PullRequestDetailsPanelState = {
  overview: PullRequestOverview | null;
  checks: PullRequestChecks | null;
  isOverviewLoading: boolean;
  isChecksLoading: boolean;
  isChecksRefreshing: boolean;
  overviewError: string;
  checksError: string;
  onRefreshChecks: () => void;
};

type PullRequestDetailsQuerySnapshot = {
  overview: PullRequestOverview | undefined;
  checks: PullRequestChecks | undefined;
  isOverviewPending: boolean;
  isOverviewFetching: boolean;
  isChecksPending: boolean;
  isChecksFetching: boolean;
  overviewError: unknown;
  checksError: unknown;
  refetchChecks: () => void;
};

type UsePullRequestDetailsArgs = {
  selectedPr: SelectedPullRequestRef | null;
  selectedRevision: SelectedPullRequestRevision | null;
  isVisible: boolean;
};

function hasPendingChecks(checks: PullRequestChecks | null | undefined) {
  return Boolean(
    checks?.status === "pending" ||
      checks?.checks.some((check) => !check.isTerminal),
  );
}

function getPullRequestChecksRefetchInterval(
  checks: PullRequestChecks | undefined,
) {
  return hasPendingChecks(checks) ? CHECKS_POLL_INTERVAL_MS : false;
}

function getPullRequestDetailsPanelState({
  overview,
  checks,
  isOverviewPending,
  isOverviewFetching,
  isChecksPending,
  isChecksFetching,
  overviewError,
  checksError,
  refetchChecks,
}: PullRequestDetailsQuerySnapshot): PullRequestDetailsPanelState {
  return {
    overview: overview ?? null,
    checks: checks ?? null,
    isOverviewLoading: isOverviewPending || (isOverviewFetching && !overview),
    isChecksLoading: isChecksPending || (isChecksFetching && !checks),
    isChecksRefreshing: isChecksFetching,
    overviewError: getErrorMessage(overviewError),
    checksError: getErrorMessage(checksError),
    onRefreshChecks: refetchChecks,
  };
}

function usePullRequestDetails({
  selectedPr,
  selectedRevision,
  isVisible,
}: UsePullRequestDetailsArgs): PullRequestDetailsPanelState {
  const pullRequestOverviewQuery = useQuery({
    ...pullRequestOverviewQueryOptions(selectedPr ?? IDLE_PULL_REQUEST_REF),
    enabled: selectedPr !== null,
  });
  const pullRequestChecksQuery = useQuery({
    ...pullRequestChecksQueryOptions(
      selectedRevision ?? IDLE_PULL_REQUEST_REVISION,
    ),
    enabled: selectedRevision !== null && isVisible,
    refetchInterval: (query) =>
      getPullRequestChecksRefetchInterval(
        query.state.data as PullRequestChecks | undefined,
      ),
  });

  return getPullRequestDetailsPanelState({
    overview: pullRequestOverviewQuery.data,
    checks: pullRequestChecksQuery.data,
    isOverviewPending: pullRequestOverviewQuery.isPending,
    isOverviewFetching: pullRequestOverviewQuery.isFetching,
    isChecksPending: pullRequestChecksQuery.isPending,
    isChecksFetching: pullRequestChecksQuery.isFetching,
    overviewError: pullRequestOverviewQuery.error,
    checksError: pullRequestChecksQuery.error,
    refetchChecks: () => {
      void pullRequestChecksQuery.refetch();
    },
  });
}

export {
  CHECKS_POLL_INTERVAL_MS,
  getPullRequestChecksRefetchInterval,
  getPullRequestDetailsPanelState,
  hasPendingChecks,
  usePullRequestDetails,
};
export type { PullRequestDetailsPanelState };
