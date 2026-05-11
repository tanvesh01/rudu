import { useCallback, useEffect, useRef } from "react";
import type { PullRequestSummary, RepoSummary } from "../types/github";

type UseTrackedPullRequestRefreshCoordinatorArgs = {
  repos: RepoSummary[];
  refreshTrackedPullRequests: (
    repo: string,
    options?: { staleTime?: number },
  ) => Promise<PullRequestSummary[]>;
};

export function useTrackedPullRequestRefreshCoordinator({
  repos,
  refreshTrackedPullRequests,
}: UseTrackedPullRequestRefreshCoordinatorArgs) {
  const initiallyRefreshedReposRef = useRef<Set<string>>(new Set());

  const refreshRepo = useCallback(
    (repo: string) => {
      return refreshTrackedPullRequests(repo);
    },
    [refreshTrackedPullRequests],
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

  return {
    refreshRepo,
  };
}
