import { useCallback, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReviewThread } from "../lib/review-threads";
import {
  githubKeys,
  initialReposQueryOptions,
  savedReposQueryOptions,
  searchReposQueryOptions,
  trackedPullRequestListQueryOptions,
} from "../queries/github";
import type {
  PullRequestDiffBundle,
  PrPatch,
  PullRequestSummary,
  RepoSummary,
  SelectedPullRequestRef,
  SelectedPullRequestRevision,
} from "../types/github";

function getErrorMessage(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  return String(error);
}

function useSavedRepos() {
  const query = useQuery(savedReposQueryOptions());
  return {
    ...query,
    repos: query.data ?? [],
  };
}

function useRepoPickerRepos(debouncedQuery: string) {
  const queryClient = useQueryClient();
  const trimmedQuery = debouncedQuery.trim();

  const { data: initialRepos = [], isPending: isInitialLoading } = useQuery(
    initialReposQueryOptions(),
  );

  const {
    data: searchRepos = [],
    error: searchError,
    isPending: isSearchLoading,
  } = useQuery({
    ...searchReposQueryOptions(debouncedQuery),
    enabled: trimmedQuery.length > 0,
  });

  useEffect(() => {
    void queryClient.prefetchQuery(initialReposQueryOptions());
  }, [queryClient]);

  const availableRepos = trimmedQuery.length > 0 ? searchRepos : initialRepos;
  const isLoadingRepos = trimmedQuery.length > 0 ? isSearchLoading : isInitialLoading;

  return {
    availableRepos,
    availableReposError: searchError,
    isLoadingRepos,
  };
}

type UseRepoPullRequestsArgs = {
  repos: RepoSummary[];
};

function useTrackedPullRequests({
  repos,
}: UseRepoPullRequestsArgs) {
  const queryClient = useQueryClient();
  const repoNames = useMemo(
    () => repos.map((repo) => repo.nameWithOwner),
    [repos],
  );

  const trackedPullRequestQueries = useQueries({
    queries: repoNames.map((repo) => ({
      ...trackedPullRequestListQueryOptions(repo),
      staleTime: Infinity,
    })),
  });

  const prsByRepo = useMemo(() => {
    const entries: Array<[string, PullRequestSummary[]]> = [];
    for (let i = 0; i < repoNames.length; i += 1) {
      const repo = repoNames[i];
      const pullRequests = trackedPullRequestQueries[i]?.data;
      if (!pullRequests) continue;
      entries.push([repo, pullRequests]);
    }
    return Object.fromEntries(entries);
  }, [repoNames, trackedPullRequestQueries]);

  const repoErrors = useMemo(() => {
    const entries: Array<[string, string]> = [];
    for (let i = 0; i < repoNames.length; i += 1) {
      const repo = repoNames[i];
      const error = trackedPullRequestQueries[i]?.error;
      if (!error) continue;
      entries.push([repo, getErrorMessage(error)]);
    }
    return Object.fromEntries(entries);
  }, [repoNames, trackedPullRequestQueries]);

  const refreshTrackedPullRequests = useCallback(
    async (repo: string) => {
      try {
        const pullRequests = await invoke<PullRequestSummary[]>(
          "refresh_tracked_pull_requests",
          { repo },
        );

        queryClient.setQueryData<PullRequestSummary[]>(
          githubKeys.trackedPullRequestList(repo),
          pullRequests,
        );

        return pullRequests;
      } catch {
        return queryClient.getQueryData<PullRequestSummary[]>(
          githubKeys.trackedPullRequestList(repo),
        ) ?? [];
      }
    },
    [queryClient],
  );

  return {
    prsByRepo,
    repoErrors,
    refreshTrackedPullRequests,
  };
}

function useSelectedPullRequestData(selectedPr: SelectedPullRequestRef | null) {
  const trackedPullRequestsQuery = useQuery({
    ...trackedPullRequestListQueryOptions(selectedPr?.repo ?? "__idle__"),
    enabled: selectedPr !== null,
  });

  const trackedPullRequests =
    (trackedPullRequestsQuery.data as PullRequestSummary[] | undefined) ?? [];

  const selectedSummary = useMemo(
    () =>
      selectedPr
        ? trackedPullRequests.find(
            (pullRequest) => pullRequest.number === selectedPr.number,
          ) ?? null
        : null,
    [selectedPr, trackedPullRequests],
  );

  const selectedRevision = useMemo<SelectedPullRequestRevision | null>(
    () =>
      selectedSummary
        ? {
            repo: selectedPr?.repo ?? "",
            number: selectedSummary.number,
            headSha: selectedSummary.headSha,
          }
        : null,
    [selectedPr?.repo, selectedSummary],
  );

  const selectedDiffRef = selectedRevision
    ? {
        repo: selectedRevision.repo,
        number: selectedRevision.number,
        headSha: selectedRevision.headSha,
      }
    : null;

  const diffBundleQuery = useQuery({
    queryKey: selectedDiffRef
      ? githubKeys.pullRequestDiffBundle(selectedDiffRef)
      : githubKeys.pullRequestDiffBundleIdle(),
    queryFn: () => {
      if (!selectedDiffRef) {
        throw new Error("No pull request selected");
      }

      return invoke<PullRequestDiffBundle>("get_pull_request_diff_bundle", {
        repo: selectedDiffRef.repo,
        number: selectedDiffRef.number,
        headSha: selectedDiffRef.headSha,
      });
    },
    enabled: selectedDiffRef !== null,
  });

  const reviewThreadsQuery = useQuery({
    queryKey: selectedRevision
      ? githubKeys.pullRequestReviewThreads(selectedRevision)
      : githubKeys.pullRequestReviewThreadsIdle(),
    queryFn: () => {
      if (!selectedRevision) {
        throw new Error("No pull request selected");
      }

      return invoke<ReviewThread[]>("get_pull_request_review_threads", {
        repo: selectedRevision.repo,
        number: selectedRevision.number,
      });
    },
    enabled: selectedRevision !== null,
  });

  const diffBundle =
    (diffBundleQuery.data as PullRequestDiffBundle | undefined) ?? null;
  const reviewThreads =
    (reviewThreadsQuery.data as ReviewThread[] | undefined) ?? [];
  const selectedPatch = useMemo<PrPatch | null>(
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
  const changedFiles = diffBundle?.changedFiles ?? [];
  const lineStats = selectedSummary
    ? {
        additions: selectedSummary.additions,
        deletions: selectedSummary.deletions,
      }
    : null;
  const fileCount = diffBundle?.changedFiles.length ?? 0;
  const patchError = getErrorMessage(diffBundleQuery.error);
  const selectedDiffKey = selectedRevision
    ? `${selectedRevision.repo}#${selectedRevision.number}@${selectedRevision.headSha}`
    : null;
  const selectedPrIdentityKey = selectedPr
    ? `${selectedPr.repo}#${selectedPr.number}`
    : null;

  const isDiffBundleLoading =
    selectedDiffRef !== null &&
    (diffBundleQuery.isPending ||
      (diffBundleQuery.isFetching && !diffBundleQuery.data));
  const isReviewThreadsLoading =
    selectedRevision !== null &&
    (reviewThreadsQuery.isPending ||
      (reviewThreadsQuery.isFetching && !reviewThreadsQuery.data));

  return {
    changedFiles,
    changedFilesError: patchError,
    diffBundle,
    diffBundleError: patchError,
    fileCount,
    isDiffBundleLoading,
    isReviewThreadsLoading,
    lineStats,
    patchError,
    reviewThreads,
    reviewThreadsError: getErrorMessage(reviewThreadsQuery.error),
    selectedDiffKey,
    selectedPatch,
    selectedPrIdentityKey,
    selectedRevision,
    selectedSummary,
  };
}

export {
  getErrorMessage,
  useRepoPickerRepos,
  useSavedRepos,
  useSelectedPullRequestData,
  useTrackedPullRequests,
};
