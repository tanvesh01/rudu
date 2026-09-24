import { useCallback, useEffect, useMemo } from "react";
import { focusManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { getErrorMessage } from "./useGithubQueries";
import {
  githubKeys,
  pullRequestDiffBundleQueryOptions,
  pullRequestSummaryRefreshQueryOptions,
  trackedPullRequestListQueryOptions,
  upsertTrackedPullRequest,
} from "../queries/github";
import type {
  PullRequestDiffBundle,
  PullRequestSummary,
  SelectedPullRequestRef,
  SelectedPullRequestRevision,
} from "../types/github";

const FOCUS_REFRESH_INTERVAL_MS = 60_000;
const IDLE_PULL_REQUEST_REVISION: SelectedPullRequestRevision = {
  repo: "__idle__",
  number: 0,
  headSha: "__idle__",
};

function getSelectedPullRequestIdentityKey(
  selectedPr: SelectedPullRequestRef | null,
) {
  return selectedPr ? `${selectedPr.repo}#${selectedPr.number}` : null;
}

function getSelectedPullRequestRevision(
  selectedPr: SelectedPullRequestRef | null,
  selectedSummary: PullRequestSummary | null,
): SelectedPullRequestRevision | null {
  if (!selectedPr || !selectedSummary) {
    return null;
  }

  return {
    repo: selectedPr.repo,
    number: selectedSummary.number,
    headSha: selectedSummary.headSha,
  };
}

function getSelectedPullRequestDiffKey(
  selectedRevision: SelectedPullRequestRevision | null,
) {
  return selectedRevision
    ? `${selectedRevision.repo}#${selectedRevision.number}@${selectedRevision.headSha}`
    : null;
}

function isSelectedRepoRefreshStale(
  lastRefreshAt: number,
  now: number = Date.now(),
) {
  return now - lastRefreshAt >= FOCUS_REFRESH_INTERVAL_MS;
}

export function useSelectedPullRequestWorkspace({
  selectedPr,
}: {
  selectedPr: SelectedPullRequestRef | null;
}) {
  const queryClient = useQueryClient();
  const trackedPullRequestsQuery = useQuery({
    ...trackedPullRequestListQueryOptions(selectedPr?.repo ?? "__idle__"),
    enabled: selectedPr !== null,
  });

  const trackedPullRequests =
    (trackedPullRequestsQuery.data as PullRequestSummary[] | undefined) ?? [];
  const isSelectedSummaryLoading =
    selectedPr !== null &&
    (trackedPullRequestsQuery.isPending ||
      (trackedPullRequestsQuery.isFetching && !trackedPullRequestsQuery.data));
  const selectedSummaryError = getErrorMessage(trackedPullRequestsQuery.error);

  const selectedSummary = useMemo(
    () =>
      selectedPr
        ? trackedPullRequests.find(
            (pullRequest) => pullRequest.number === selectedPr.number,
          ) ?? null
        : null,
    [selectedPr, trackedPullRequests],
  );

  const selectedRevision = useMemo(
    () => getSelectedPullRequestRevision(selectedPr, selectedSummary),
    [selectedPr, selectedSummary],
  );

  const selectedDiffRef = selectedRevision
    ? {
        repo: selectedRevision.repo,
        number: selectedRevision.number,
        headSha: selectedRevision.headSha,
      }
    : null;

  const diffBundleQuery = useQuery({
    ...pullRequestDiffBundleQueryOptions(
      selectedDiffRef ?? IDLE_PULL_REQUEST_REVISION,
    ),
    enabled: selectedDiffRef !== null,
  });

  const diffBundle =
    (diffBundleQuery.data as PullRequestDiffBundle | undefined) ?? null;
  const diffBundleError = getErrorMessage(diffBundleQuery.error);
  const selectedPatch = useMemo(
    () =>
      diffBundle
        ? {
            repo: diffBundle.repo,
            number: diffBundle.number,
            headSha: diffBundle.headSha,
            patch: diffBundle.patch,
          }
        : null,
    [diffBundle],
  );
  const lineStats = selectedSummary
    ? {
        additions: selectedSummary.additions,
        deletions: selectedSummary.deletions,
      }
    : null;
  const missingTrackedPullRequestError =
    selectedPr !== null &&
    !isSelectedSummaryLoading &&
    !selectedSummaryError &&
    trackedPullRequestsQuery.data &&
    !selectedSummary
      ? `Track ${selectedPr.repo}#${selectedPr.number} to view its diff.`
      : "";
  const selectedPatchError =
    selectedSummaryError || missingTrackedPullRequestError || diffBundleError;

  const refreshSelectedPullRequestIfStale = useCallback(() => {
    if (!selectedPr) {
      return null;
    }

    const refreshState = queryClient.getQueryState(
      githubKeys.selectedPullRequestSummaryRefresh(selectedPr),
    );
    const lastRefreshAt = Math.max(
      refreshState?.dataUpdatedAt ?? 0,
      refreshState?.errorUpdatedAt ?? 0,
    );
    if (!isSelectedRepoRefreshStale(lastRefreshAt)) {
      return null;
    }

    return queryClient
      .fetchQuery({
        ...pullRequestSummaryRefreshQueryOptions(selectedPr),
        staleTime: FOCUS_REFRESH_INTERVAL_MS,
      })
      .then((pullRequest) => {
        queryClient.setQueryData<PullRequestSummary[]>(
          githubKeys.trackedPullRequestList(selectedPr.repo),
          (current) => upsertTrackedPullRequest(current, pullRequest),
        );
      })
      .catch(() => undefined);
  }, [queryClient, selectedPr]);

  useEffect(() => {
    return focusManager.subscribe((isFocused) => {
      if (!isFocused || !selectedPr) {
        return;
      }

      void refreshSelectedPullRequestIfStale();
    });
  }, [refreshSelectedPullRequestIfStale, selectedPr]);

  return {
    data: {
      changedFiles: diffBundle?.changedFiles ?? [],
      diffBundle,
      lineStats,
      selectedDiffKey: getSelectedPullRequestDiffKey(selectedRevision),
      selectedPatch,
      selectedPrIdentityKey: getSelectedPullRequestIdentityKey(selectedPr),
      selectedRevision,
      selectedSummary,
    },
    status: {
      changedFilesError: selectedPatchError,
      diffBundleError: selectedPatchError,
      isDiffBundleLoading:
        isSelectedSummaryLoading ||
        (selectedDiffRef !== null &&
          (diffBundleQuery.isPending ||
            (diffBundleQuery.isFetching && !diffBundleQuery.data))),
      patchError: selectedPatchError,
    },
  };
}

export {
  FOCUS_REFRESH_INTERVAL_MS,
  getSelectedPullRequestDiffKey,
  getSelectedPullRequestIdentityKey,
  getSelectedPullRequestRevision,
  isSelectedRepoRefreshStale,
};
