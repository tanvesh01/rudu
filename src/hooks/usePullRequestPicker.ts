import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getErrorMessage } from "./useGithubQueries";
import { pullRequestListQueryOptions } from "../queries/github";
import { usePickerWorkflowStore } from "../stores";
import type { RepoSummary } from "../types/github";

export type PullRequestPickerMode = "repo-then-pr" | "pr-only";
export type PullRequestPickerStep = "repo" | "pull-request";

export function usePullRequestPicker() {
  const isPickerOpen = usePickerWorkflowStore((s) => s.isPickerOpen);
  const pickerMode = usePickerWorkflowStore((s) => s.pickerMode);
  const pickerStep = usePickerWorkflowStore((s) => s.pickerStep);
  const pickerRepo = usePickerWorkflowStore((s) => s.pickerRepo);
  const debouncedQuery = usePickerWorkflowStore((s) => s.debouncedQuery);
  const isSavingRepo = usePickerWorkflowStore((s) => s.isSavingRepo);
  const isOpeningPullRequestLink = usePickerWorkflowStore(
    (s) => s.isOpeningPullRequestLink,
  );
  const isTrackingPullRequest = usePickerWorkflowStore(
    (s) => s.isTrackingPullRequest,
  );
  const manualEntryError = usePickerWorkflowStore((s) => s.manualEntryError);

  const actions = usePickerWorkflowStore((s) => s.actions);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const updateSearch = useCallback(
    (value: string) => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(
        () => actions.searchQueryChanged(value),
        300,
      );
    },
    [actions],
  );

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const pickerRepoName = pickerRepo?.nameWithOwner ?? null;
  const pickerOpenPullRequestsQuery = useQuery({
    ...pullRequestListQueryOptions(pickerRepoName ?? "__idle__"),
    enabled:
      isPickerOpen &&
      pickerStep === "pull-request" &&
      pickerRepoName !== null,
  });
  const pickerOpenPullRequests = pickerOpenPullRequestsQuery.data ?? [];
  const pickerPullRequestsError = getErrorMessage(
    pickerOpenPullRequestsQuery.error,
  );

  function resetPickerState() {
    clearTimeout(debounceRef.current);
    actions.pickerStateReset();
  }

  function openRepoPicker() {
    actions.openRepoPicker();
  }

  function openRepoPullRequestPicker(
    repoNameWithOwner: string,
    repos: RepoSummary[],
  ) {
    const repo = repos.find(
      (candidate) => candidate.nameWithOwner === repoNameWithOwner,
    );
    if (!repo) return;
    actions.openRepoPullRequestPicker(repo);
  }

  return {
    isPickerOpen,
    pickerMode,
    pickerStep,
    pickerRepo,
    debouncedQuery,
    isSavingRepo,
    isOpeningPullRequestLink,
    isTrackingPullRequest,
    manualEntryError,
    updateSearch,
    pickerRepoName,
    pickerOpenPullRequests,
    pickerPullRequestsError,
    isLoadingPullRequests:
      isPickerOpen &&
      pickerStep === "pull-request" &&
      pickerRepoName !== null &&
      pickerOpenPullRequestsQuery.isPending,
    resetPickerState,
    openRepoPicker,
    openRepoPullRequestPicker,
    actions,
  };
}
