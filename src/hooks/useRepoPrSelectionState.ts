import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PullRequestSummary,
  RepoSummary,
  SelectedPullRequestRef,
} from "../types/github";

export function useRepoPrSelectionState({ repos }: { repos: RepoSummary[] }) {
  const [selectedPr, setSelectedPr] = useState<SelectedPullRequestRef | null>(
    null,
  );
  const [openRepoValues, setOpenRepoValues] = useState<string[]>([]);
  const previousRepoNamesRef = useRef<string[]>([]);

  const repoNames = useMemo(
    () => repos.map((repo) => repo.nameWithOwner),
    [repos],
  );

  useEffect(() => {
    const previousRepoNames = previousRepoNamesRef.current;
    const addedRepoNames = repoNames.filter(
      (repoName) => !previousRepoNames.includes(repoName),
    );

    setOpenRepoValues((current) => {
      const nextOpenRepos = current.filter((repoName) =>
        repoNames.includes(repoName),
      );

      for (const repoName of addedRepoNames) {
        if (!nextOpenRepos.includes(repoName)) {
          nextOpenRepos.push(repoName);
        }
      }

      if (
        nextOpenRepos.length === current.length &&
        nextOpenRepos.every((repoName, index) => repoName === current[index])
      ) {
        return current;
      }

      return nextOpenRepos;
    });

    previousRepoNamesRef.current = repoNames;
  }, [repoNames]);

  function handleRepoOpenChange(repo: string, open: boolean) {
    setOpenRepoValues((current) => {
      if (open) {
        return current.includes(repo) ? current : [...current, repo];
      }

      return current.filter((value) => value !== repo);
    });
  }

  function handleSelectPr(repo: string, pullRequest: PullRequestSummary) {
    setSelectedPr({
      repo,
      number: pullRequest.number,
    });
  }

  return {
    selectedPr,
    setSelectedPr,
    openRepoValues,
    handleRepoOpenChange,
    handleSelectPr,
  };
}
