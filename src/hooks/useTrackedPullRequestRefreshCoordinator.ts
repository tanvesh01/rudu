import { useCallback, useEffect, useRef } from "react";
import { focusManager, useQueryClient } from "@tanstack/react-query";
import { githubKeys } from "../queries/github";
import type {
  PullRequestSummary,
  RepoSummary,
  SelectedPullRequestRef,
} from "../types/github";

const FOCUS_REFRESH_INTERVAL_MS = 60_000;

type UseTrackedPullRequestRefreshCoordinatorArgs = {
  repos: RepoSummary[];
  selectedPr: SelectedPullRequestRef | null;
  refreshTrackedPullRequests: (
    repo: string,
    options?: { staleTime?: number },
  ) => Promise<PullRequestSummary[]>;
};

export function useTrackedPullRequestRefreshCoordinator({
  repos,
  selectedPr,
  refreshTrackedPullRequests,
}: UseTrackedPullRequestRefreshCoordinatorArgs) {
  const queryClient = useQueryClient();
  const initiallyRefreshedReposRef = useRef<Set<string>>(new Set());

  const refreshRepo = useCallback(
    (repo: string) => {
      return refreshTrackedPullRequests(repo);
    },
    [refreshTrackedPullRequests],
  );

  const refreshRepoIfStale = useCallback(
    (repo: string) => {
      const refreshState = queryClient.getQueryState(
        githubKeys.trackedPullRequestRefresh(repo),
      );
      const lastRefreshAt = Math.max(
        refreshState?.dataUpdatedAt ?? 0,
        refreshState?.errorUpdatedAt ?? 0,
      );
      if (Date.now() - lastRefreshAt < FOCUS_REFRESH_INTERVAL_MS) {
        return null;
      }

      return refreshTrackedPullRequests(repo, {
        staleTime: FOCUS_REFRESH_INTERVAL_MS,
      });
    },
    [queryClient, refreshTrackedPullRequests],
  );

  useEffect(() => {
    for (const repo of repos) {
      const repoName = repo.nameWithOwner;
      if (initiallyRefreshedReposRef.current.has(repoName)) {
        continue;
      }

      initiallyRefreshedReposRef.current.add(repoName);
      void refreshRepo(repoName);
    }
  }, [refreshRepo, repos]);

  useEffect(() => {
    return focusManager.subscribe((isFocused) => {
      if (!isFocused || !selectedPr) {
        return;
      }

      void refreshRepoIfStale(selectedPr.repo);
    });
  }, [refreshRepoIfStale, selectedPr]);

  return {
    refreshRepo,
    refreshRepoIfStale,
  };
}
