import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  githubKeys,
  initialReposQueryOptions,
  savedReposQueryOptions,
  searchReposQueryOptions,
  trackedPullRequestListQueryOptions,
} from "../queries/github";
import type {
  PrPatch,
  PullRequestSummary,
  RepoSummary,
  SelectedPullRequest,
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
  setSelectedPr: Dispatch<SetStateAction<SelectedPullRequest | null>>;
};

function useTrackedPullRequests({
  repos,
  setSelectedPr,
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

        setSelectedPr((current) => {
          if (!current || current.repo !== repo) return current;
          const refreshedSelection = pullRequests.find(
            (pullRequest) => pullRequest.number === current.number,
          );

          if (
            !refreshedSelection ||
            refreshedSelection.headSha === current.headSha
          ) {
            return current;
          }

          return {
            ...current,
            headSha: refreshedSelection.headSha,
          };
        });

        return pullRequests;
      } catch {
        return queryClient.getQueryData<PullRequestSummary[]>(
          githubKeys.trackedPullRequestList(repo),
        ) ?? [];
      }
    },
    [queryClient, setSelectedPr],
  );

  return {
    prsByRepo,
    repoErrors,
    refreshTrackedPullRequests,
  };
}

function useSelectedPullRequestData(selectedPr: SelectedPullRequest | null) {
  const selectedPatchQuery = useQuery({
    queryKey: selectedPr
      ? githubKeys.pullRequestPatch(selectedPr)
      : githubKeys.pullRequestPatchIdle(),
    queryFn: () => {
      if (!selectedPr) {
        throw new Error("No pull request selected");
      }

      return invoke<PrPatch>("get_pull_request_patch", {
        repo: selectedPr.repo,
        number: selectedPr.number,
        headSha: selectedPr.headSha,
      });
    },
    enabled: selectedPr !== null,
  });

  const changedFilesQuery = useQuery({
    queryKey: selectedPr
      ? githubKeys.pullRequestFiles(selectedPr)
      : githubKeys.pullRequestFilesIdle(),
    queryFn: () => {
      if (!selectedPr) {
        throw new Error("No pull request selected");
      }

      return invoke<string[]>("list_pull_request_changed_files", {
        repo: selectedPr.repo,
        number: selectedPr.number,
        headSha: selectedPr.headSha,
      });
    },
    enabled: selectedPr !== null,
  });

  const selectedPatch = (selectedPatchQuery.data as PrPatch | undefined) ?? null;
  const changedFiles = (changedFilesQuery.data as string[] | undefined) ?? [];

  const isPatchLoading =
    selectedPr !== null &&
    (selectedPatchQuery.isPending ||
      (selectedPatchQuery.isFetching && !selectedPatchQuery.data));
  const isChangedFilesLoading =
    selectedPr !== null &&
    (changedFilesQuery.isPending ||
      (changedFilesQuery.isFetching && !changedFilesQuery.data));

  return {
    changedFiles,
    changedFilesError: getErrorMessage(changedFilesQuery.error),
    isChangedFilesLoading,
    isPatchLoading,
    patchError: getErrorMessage(selectedPatchQuery.error),
    selectedPatch,
  };
}

export {
  getErrorMessage,
  useRepoPickerRepos,
  useSavedRepos,
  useSelectedPullRequestData,
  useTrackedPullRequests,
};
