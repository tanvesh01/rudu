import { create } from "zustand";

type RepoOpenState = {
  openRepoValues: string[];
};

type RepoOpenActions = {
  handleRepoOpenChange: (repo: string, open: boolean) => void;
  syncRepos: (repoNames: string[]) => void;
};

const useRepoOpenStore = create<RepoOpenState & RepoOpenActions>((set) => ({
  openRepoValues: [],
  handleRepoOpenChange: (repo, open) =>
    set((state) => {
      if (open) {
        return state.openRepoValues.includes(repo)
          ? state
          : { openRepoValues: [...state.openRepoValues, repo] };
      }

      return {
        openRepoValues: state.openRepoValues.filter((value) => value !== repo),
      };
    }),
  syncRepos: (repoNames) =>
    set((state) => {
      const currentSet = new Set(repoNames);
      const nextOpenRepos = state.openRepoValues.filter((repoName) =>
        currentSet.has(repoName),
      );

      for (const repoName of repoNames) {
        if (!nextOpenRepos.includes(repoName)) {
          nextOpenRepos.push(repoName);
        }
      }

      if (
        nextOpenRepos.length === state.openRepoValues.length &&
        nextOpenRepos.every((repoName, index) => repoName === state.openRepoValues[index])
      ) {
        return state;
      }

      return { openRepoValues: nextOpenRepos };
    }),
}));

export { useRepoOpenStore };
