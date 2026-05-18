import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { savedReposQueryOptions } from "../queries/github";
import { saveRepo } from "../queries/github-native";
import type { RepoSummary } from "../types/github";

export function useRepoPersistence() {
  const queryClient = useQueryClient();
  const [isSavingRepo, setIsSavingRepo] = useState(false);

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
    setIsSavingRepo(true);
    try {
      return await persistRepo(repo);
    } finally {
      setIsSavingRepo(false);
    }
  }

  return { isSavingRepo, persistRepo, handlePickRepo };
}
