import { useCallback, useEffect, useMemo } from "react";
import { focusManager, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReviewThread } from "../lib/review-threads";
import { usePullRequestReviewCommentMutations } from "./usePullRequestReviewCommentMutations";
import { getErrorMessage } from "./useGithubQueries";
import {
  githubKeys,
  pullRequestDiffBundleQueryOptions,
  pullRequestReviewThreadsQueryOptions,
  pullRequestSummaryRefreshQueryOptions,
  trackedPullRequestListQueryOptions,
  upsertTrackedPullRequest,
} from "../queries/github";
import type {
  CreatePullRequestReviewCommentInput,
  PullRequestDiffBundle,
  PullRequestSummary,
  ReplyToPullRequestReviewCommentInput,
  SelectedPullRequestRef,
  SelectedPullRequestRevision,
  UpdatePullRequestReviewCommentInput,
} from "../types/github";

const FOCUS_REFRESH_INTERVAL_MS = 60_000;
const IDLE_PULL_REQUEST_REVISION: SelectedPullRequestRevision = {
  repo: "__idle__",
  number: 0,
  headSha: "__idle__",
};

type RefreshTrackedPullRequests = (
  repo: string,
  options?: { staleTime?: number },
) => Promise<PullRequestSummary[]>;

type UseSelectedPullRequestWorkspaceArgs = {
  selectedPr: SelectedPullRequestRef | null;
  refreshTrackedPullRequests: RefreshTrackedPullRequests;
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
  refreshTrackedPullRequests,
}: UseSelectedPullRequestWorkspaceArgs) {
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

  const reviewThreadsQuery = useQuery({
    ...pullRequestReviewThreadsQueryOptions(
      selectedRevision ?? IDLE_PULL_REQUEST_REVISION,
    ),
    enabled: selectedRevision !== null,
  });

  const refreshSelectedPullRequestWorkspace = useCallback(
    async (pullRequest: SelectedPullRequestRevision | null) => {
      if (!pullRequest) {
        return;
      }

      let nextRevision = pullRequest;

      try {
        const refreshedPullRequest = await queryClient.fetchQuery(
          pullRequestSummaryRefreshQueryOptions({
            repo: pullRequest.repo,
            number: pullRequest.number,
          }),
        );
        queryClient.setQueryData<PullRequestSummary[]>(
          githubKeys.trackedPullRequestList(pullRequest.repo),
          (current) => upsertTrackedPullRequest(current, refreshedPullRequest),
        );

        nextRevision = {
          repo: pullRequest.repo,
          number: refreshedPullRequest.number,
          headSha: refreshedPullRequest.headSha,
        };
      } catch {
        nextRevision = pullRequest;
      }

      if (nextRevision.headSha !== pullRequest.headSha) {
        try {
          await queryClient.prefetchQuery(
            pullRequestDiffBundleQueryOptions(nextRevision),
          );
        } catch {
          // The mounted diff query will surface any bundle refresh error.
        }
      }

      try {
        const nextReviewThreadsOptions =
          pullRequestReviewThreadsQueryOptions(nextRevision);
        await queryClient.refetchQueries({
          exact: true,
          queryKey: nextReviewThreadsOptions.queryKey,
        });
      } catch {
        return;
      }
    },
    [queryClient],
  );

  const reviewCommentMutations = usePullRequestReviewCommentMutations({
    selectedPr: selectedRevision,
    onMutationSettled: refreshSelectedPullRequestWorkspace,
  });

  const refreshSelectedRepo = useCallback(() => {
    if (!selectedPr) {
      return Promise.resolve<PullRequestSummary[]>([]);
    }

    return refreshTrackedPullRequests(selectedPr.repo);
  }, [refreshTrackedPullRequests, selectedPr]);

  const refreshSelectedRepoIfStale = useCallback(() => {
    if (!selectedPr) {
      return null;
    }

    const refreshState = queryClient.getQueryState(
      githubKeys.trackedPullRequestRefresh(selectedPr.repo),
    );
    const lastRefreshAt = Math.max(
      refreshState?.dataUpdatedAt ?? 0,
      refreshState?.errorUpdatedAt ?? 0,
    );
    if (!isSelectedRepoRefreshStale(lastRefreshAt)) {
      return null;
    }

    return refreshTrackedPullRequests(selectedPr.repo, {
      staleTime: FOCUS_REFRESH_INTERVAL_MS,
    });
  }, [queryClient, refreshTrackedPullRequests, selectedPr]);

  useEffect(() => {
    return focusManager.subscribe((isFocused) => {
      if (!isFocused || !selectedPr) {
        return;
      }

      void refreshSelectedRepoIfStale();
    });
  }, [refreshSelectedRepoIfStale, selectedPr]);

  const diffBundle =
    (diffBundleQuery.data as PullRequestDiffBundle | undefined) ?? null;
  const diffBundleError = getErrorMessage(diffBundleQuery.error);
  const reviewThreads =
    (reviewThreadsQuery.data as ReviewThread[] | undefined) ?? [];
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

  return {
    data: {
      changedFiles: diffBundle?.changedFiles ?? [],
      diffBundle,
      lineStats,
      reviewThreads,
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
      isReviewThreadsLoading:
        selectedRevision !== null &&
        (reviewThreadsQuery.isPending ||
          (reviewThreadsQuery.isFetching && !reviewThreadsQuery.data)),
      patchError: selectedPatchError,
      reviewThreadsError: getErrorMessage(reviewThreadsQuery.error),
    },
    actions: {
      refreshSelectedPullRequestWorkspace,
      refreshSelectedRepo,
      refreshSelectedRepoIfStale,
    },
    reviewComments: {
      createComment: (input: CreatePullRequestReviewCommentInput) =>
        reviewCommentMutations.createCommentMutation.mutateAsync(input),
      isCreateCommentPending:
        reviewCommentMutations.createCommentMutation.isPending,
      replyToComment: (input: ReplyToPullRequestReviewCommentInput) =>
        reviewCommentMutations.replyCommentMutation.mutateAsync(input),
      updateComment: (input: UpdatePullRequestReviewCommentInput) =>
        reviewCommentMutations.updateCommentMutation.mutateAsync(input),
      viewerLogin: reviewCommentMutations.viewerLogin,
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
export type { RefreshTrackedPullRequests };
