import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getErrorMessage } from "./useGithubQueries";
import { pullRequestListQueryOptions } from "../queries/github";
import { usePickerWorkflowStore } from "../stores";
import type { RepoSummary } from "../types/github";

export type PullRequestPickerMode = "repo-then-pr" | "pr-only";
export type PullRequestPickerStep = "repo" | "pull-request";

export function usePullRequestPicker() {
  const store = usePickerWorkflowStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const updateSearch = useCallback(
    (value: string) => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(
        () => store.setDebouncedQuery(value),
        300,
      );
    },
    [store],
  );

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const pickerRepoName = store.pickerRepo?.nameWithOwner ?? null;
  const pickerOpenPullRequestsQuery = useQuery({
    ...pullRequestListQueryOptions(pickerRepoName ?? "__idle__"),
    enabled:
      store.isPickerOpen &&
      store.pickerStep === "pull-request" &&
      pickerRepoName !== null,
  });
  const pickerOpenPullRequests = pickerOpenPullRequestsQuery.data ?? [];
  const pickerPullRequestsError = getErrorMessage(
    pickerOpenPullRequestsQuery.error,
  );

  function resetPickerState() {
    clearTimeout(debounceRef.current);
    store.setDebouncedQuery("");
    store.setPickerStep(
      store.pickerMode === "pr-only" ? "pull-request" : "repo",
    );
    if (store.pickerMode === "repo-then-pr") {
      store.setPickerRepo(null);
    }
  }

  function openRepoPicker() {
    store.openRepoPicker();
  }

  function openRepoPullRequestPicker(
    repoNameWithOwner: string,
    repos: RepoSummary[],
  ) {
    const repo = repos.find(
      (candidate) => candidate.nameWithOwner === repoNameWithOwner,
    );
    if (!repo) return;
    store.openRepoPullRequestPicker(repo);
  }

  return {
    isPickerOpen: store.isPickerOpen,
    setIsPickerOpen: store.setIsPickerOpen,
    pickerMode: store.pickerMode,
    pickerStep: store.pickerStep,
    pickerRepo: store.pickerRepo,
    debouncedQuery: store.debouncedQuery,
    updateSearch,
    pickerRepoName,
    pickerOpenPullRequests,
    pickerPullRequestsError,
    isLoadingPullRequests:
      store.isPickerOpen &&
      store.pickerStep === "pull-request" &&
      pickerRepoName !== null &&
      pickerOpenPullRequestsQuery.isPending,
    resetPickerState,
    openRepoPicker,
    openRepoPullRequestPicker,
    setPickerStep: store.setPickerStep,
    setPickerRepo: store.setPickerRepo,
  };
}
