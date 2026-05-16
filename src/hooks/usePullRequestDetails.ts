import { useQuery } from "@tanstack/react-query";
import { getErrorMessage } from "./useGithubQueries";
import {
  pullRequestChecksQueryOptions,
  pullRequestOverviewQueryOptions,
} from "../queries/github";
import type {
  PullRequestChecks,
  SelectedPullRequestRef,
  SelectedPullRequestRevision,
} from "../types/github";

const IDLE_PULL_REQUEST_REF: SelectedPullRequestRef = {
  repo: "__idle__",
  number: 0,
};

const IDLE_PULL_REQUEST_REVISION: SelectedPullRequestRevision = {
  repo: "__idle__",
  number: 0,
  headSha: "__idle__",
};

type UsePullRequestDetailsArgs = {
  isPullRequestPanelActive: boolean;
  selectedPr: SelectedPullRequestRef | null;
  selectedRevision: SelectedPullRequestRevision | null;
};

function hasPendingChecks(checks: PullRequestChecks | undefined) {
  return Boolean(
    checks?.status === "pending" ||
      checks?.checks.some((check) => !check.isTerminal),
  );
}

function usePullRequestDetails({
  isPullRequestPanelActive,
  selectedPr,
  selectedRevision,
}: UsePullRequestDetailsArgs) {
  const selectedPrQueryRef = selectedPr ?? IDLE_PULL_REQUEST_REF;
  const overviewQuery = useQuery({
    ...pullRequestOverviewQueryOptions(selectedPrQueryRef),
    enabled: selectedPr !== null,
  });

  const selectedChecksQueryRef =
    selectedRevision ?? IDLE_PULL_REQUEST_REVISION;
  const checksQuery = useQuery({
    ...pullRequestChecksQueryOptions(selectedChecksQueryRef),
    enabled: selectedRevision !== null && isPullRequestPanelActive,
    refetchInterval: (query) => {
      const checks = query.state.data as PullRequestChecks | undefined;
      return hasPendingChecks(checks) ? 5000 : false;
    },
  });

  return {
    checks: checksQuery.data ?? null,
    checksError: getErrorMessage(checksQuery.error),
    isChecksLoading:
      selectedRevision !== null &&
      isPullRequestPanelActive &&
      (checksQuery.isPending || (checksQuery.isFetching && !checksQuery.data)),
    isChecksRefreshing: checksQuery.isFetching,
    isOverviewLoading:
      selectedPr !== null &&
      (overviewQuery.isPending ||
        (overviewQuery.isFetching && !overviewQuery.data)),
    onRefreshChecks: () => {
      void checksQuery.refetch();
    },
    overview: overviewQuery.data ?? null,
    overviewError: getErrorMessage(overviewQuery.error),
  };
}

export { hasPendingChecks, usePullRequestDetails };
export type { UsePullRequestDetailsArgs };
