import { useQueryClient } from "@tanstack/react-query";
import { savedReposQueryOptions } from "../queries/github";
import { saveRepo } from "../queries/github-native";
import { usePickerWorkflowStore } from "../stores";
import type { RepoSummary } from "../types/github";

export function useRepoPersistence() {
  const queryClient = useQueryClient();
  const storeActions = usePickerWorkflowStore.getState().actions;

  async function persistRepo(repo: RepoSummary) {
    const savedRepo = await saveRepo(repo);
    queryClient.setQueryData<RepoSummary[]>(
      savedReposQueryOptions().queryKey,
      (current) => {
        if (!current) return [savedRepo];
        if (
          current.some((item) => item.nameWithOwner === savedRepo.nameWithOwner)
        ) {
          return current;
        }
        return [...current, savedRepo];
      },
    );
    return savedRepo;
  }

  async function handlePickRepo(repo: RepoSummary) {
    storeActions.repoSaveStarted();
    try {
      return await persistRepo(repo);
    } finally {
      storeActions.repoSaveCompleted();
    }
  }

  return { persistRepo, handlePickRepo };
}
