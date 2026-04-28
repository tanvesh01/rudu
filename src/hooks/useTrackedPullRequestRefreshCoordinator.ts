import { useCallback, useEffect, useRef } from "react";
import { focusManager } from "@tanstack/react-query";
import type {
  PullRequestSummary,
  RepoSummary,
  SelectedPullRequestRef,
} from "../types/github";

const FOCUS_REFRESH_INTERVAL_MS = 60_000;

type UseTrackedPullRequestRefreshCoordinatorArgs = {
  repos: RepoSummary[];
  selectedPr: SelectedPullRequestRef | null;
  refreshTrackedPullRequests: (repo: string) => Promise<PullRequestSummary[]>;
};

export function useTrackedPullRequestRefreshCoordinator({
  repos,
  selectedPr,
  refreshTrackedPullRequests,
}: UseTrackedPullRequestRefreshCoordinatorArgs) {
  const initiallyRefreshedReposRef = useRef<Set<string>>(new Set());
  const inFlightRefreshesRef = useRef<Map<string, Promise<PullRequestSummary[]>>>(
    new Map(),
  );
  const lastRefreshByRepoRef = useRef<Map<string, number>>(new Map());

  const refreshRepo = useCallback(
    (repo: string) => {
      const inFlight = inFlightRefreshesRef.current.get(repo);
      if (inFlight) {
        return inFlight;
      }

      const refresh = refreshTrackedPullRequests(repo)
        .then((pullRequests) => {
          lastRefreshByRepoRef.current.set(repo, Date.now());
          return pullRequests;
        })
        .finally(() => {
          inFlightRefreshesRef.current.delete(repo);
        });

      inFlightRefreshesRef.current.set(repo, refresh);
      return refresh;
    },
    [refreshTrackedPullRequests],
  );

  const refreshRepoIfStale = useCallback(
    (repo: string) => {
      const lastRefreshAt = lastRefreshByRepoRef.current.get(repo) ?? 0;
      if (Date.now() - lastRefreshAt < FOCUS_REFRESH_INTERVAL_MS) {
        return null;
      }

      return refreshRepo(repo);
    },
    [refreshRepo],
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
