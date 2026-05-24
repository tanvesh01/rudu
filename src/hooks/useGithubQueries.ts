import { useCallback, useMemo } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  githubKeys,
  initialReposQueryOptions,
  issueDashboardQueryOptions,
  savedReposQueryOptions,
  searchReposQueryOptions,
  trackedPullRequestListQueryOptions,
  trackedPullRequestRefreshQueryOptions,
} from "../queries/github";
import type {
  PullRequestSummary,
  RepoSummary,
} from "../types/github";
import type { IssueDashboardData } from "../types/issues";

import { getErrorMessage } from "../lib/get-error-message";

function useSavedRepos() {
  const query = useQuery(savedReposQueryOptions());
  return {
    ...query,
    repos: query.data ?? [],
  };
}

function useRepoPickerRepos(debouncedQuery: string, enabled: boolean) {
  const trimmedQuery = debouncedQuery.trim();

  const {
    data: initialRepoDiscovery,
    error: initialError,
    isFetching: isInitialFetching,
    isPending: isInitialPending,
  } = useQuery({
    ...initialReposQueryOptions(),
    enabled: enabled && trimmedQuery.length === 0,
  });

  const {
    data: searchRepoDiscovery,
    error: searchError,
    isFetching: isSearchFetching,
    isPending: isSearchLoading,
  } = useQuery({
    ...searchReposQueryOptions(debouncedQuery),
    enabled: enabled && trimmedQuery.length > 0,
  });

  const activeDiscovery =
    trimmedQuery.length > 0 ? searchRepoDiscovery : initialRepoDiscovery;
  const availableRepos = activeDiscovery?.repos ?? [];
  const availableReposError = trimmedQuery.length > 0 ? searchError : initialError;
  const availableReposWarning = activeDiscovery?.warning ?? null;
  const isLoadingRepos =
    trimmedQuery.length > 0
      ? isSearchLoading || isSearchFetching
      : isInitialPending || isInitialFetching;

  return {
    availableRepos,
    availableReposError,
    availableReposWarning,
    isLoadingRepos,
  };
}

function countDashboardIssues(dashboard: IssueDashboardData | undefined) {
  if (!dashboard) return null;

  const { buckets } = dashboard;
  return (
    buckets.inProgress.length +
    buckets.assigned.length +
    buckets.subscribed.length +
    buckets.created.length
  );
}

function useIssueDashboard() {
  const query = useQuery(issueDashboardQueryOptions());
  return {
    ...query,
    count: countDashboardIssues(query.data),
    dashboard: query.data,
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
    async (repo: string, options?: { staleTime?: number }) => {
      try {
        const pullRequests = await queryClient.fetchQuery({
          ...trackedPullRequestRefreshQueryOptions(repo),
          staleTime: options?.staleTime ?? 0,
        });

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

export {
  getErrorMessage,
  useIssueDashboard,
  useRepoPickerRepos,
  useSavedRepos,
  useTrackedPullRequests,
};
