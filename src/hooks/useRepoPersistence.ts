import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { savedReposQueryOptions } from "../queries/github";
import { saveRepo } from "../queries/github-native";
import { usePickerWorkflowStore } from "../stores";
import type { RepoSummary } from "../types/github";

export function useRepoPersistence() {
  const queryClient = useQueryClient();
  const storeActions = usePickerWorkflowStore.getState().actions;

  const persistRepo = useCallback(
    async (repo: RepoSummary) => {
      const savedRepo = await saveRepo(repo);
      queryClient.setQueryData<RepoSummary[]>(
        savedReposQueryOptions().queryKey,
        (current) => {
          if (!current) return [savedRepo];
          if (
            current.some(
              (item) => item.nameWithOwner === savedRepo.nameWithOwner,
            )
          ) {
            return current;
          }
          return [...current, savedRepo];
        },
      );
      return savedRepo;
    },
    [queryClient],
  );

  const handlePickRepo = useCallback(
    async (repo: RepoSummary) => {
      storeActions.repoSaveStarted();
      try {
        return await persistRepo(repo);
      } finally {
        storeActions.repoSaveCompleted();
      }
    },
    [persistRepo, storeActions],
  );

  return { persistRepo, handlePickRepo };
}
