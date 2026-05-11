import { useCallback, useMemo } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  githubKeys,
  initialReposQueryOptions,
  savedReposQueryOptions,
  searchReposQueryOptions,
  trackedPullRequestListQueryOptions,
  trackedPullRequestRefreshQueryOptions,
} from "../queries/github";
import type {
  PullRequestSummary,
  RepoSummary,
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

function useRepoPickerRepos(debouncedQuery: string, enabled: boolean) {
  const trimmedQuery = debouncedQuery.trim();

  const {
    data: initialRepos = [],
    isFetching: isInitialFetching,
    isPending: isInitialPending,
  } = useQuery({
    ...initialReposQueryOptions(),
    enabled: enabled && trimmedQuery.length === 0,
  });

  const {
    data: searchRepos = [],
    error: searchError,
    isFetching: isSearchFetching,
    isPending: isSearchLoading,
  } = useQuery({
    ...searchReposQueryOptions(debouncedQuery),
    enabled: enabled && trimmedQuery.length > 0,
  });

  const availableRepos = trimmedQuery.length > 0 ? searchRepos : initialRepos;
  const isLoadingRepos =
    trimmedQuery.length > 0
      ? isSearchLoading || isSearchFetching
      : isInitialPending || isInitialFetching;

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
  useRepoPickerRepos,
  useSavedRepos,
  useTrackedPullRequests,
};
