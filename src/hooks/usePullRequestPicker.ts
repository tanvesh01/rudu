import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getErrorMessage } from "./useGithubQueries";
import { pullRequestListQueryOptions } from "../queries/github";
import type { RepoSummary } from "../types/github";

export type PullRequestPickerMode = "repo-then-pr" | "pr-only";
export type PullRequestPickerStep = "repo" | "pull-request";

export function usePullRequestPicker() {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] =
    useState<PullRequestPickerMode>("repo-then-pr");
  const [pickerStep, setPickerStep] = useState<PullRequestPickerStep>("repo");
  const [pickerRepo, setPickerRepo] = useState<RepoSummary | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const updateSearch = useCallback((value: string) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 300);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const pickerRepoName = pickerRepo?.nameWithOwner ?? null;
  const pickerOpenPullRequestsQuery = useQuery({
    ...pullRequestListQueryOptions(pickerRepoName ?? "__idle__"),
    enabled:
      isPickerOpen && pickerStep === "pull-request" && pickerRepoName !== null,
  });
  const pickerOpenPullRequests = pickerOpenPullRequestsQuery.data ?? [];
  const pickerPullRequestsError = getErrorMessage(
    pickerOpenPullRequestsQuery.error,
  );

  function resetPickerState() {
    clearTimeout(debounceRef.current);
    setDebouncedQuery("");
    setPickerStep(pickerMode === "pr-only" ? "pull-request" : "repo");
    if (pickerMode === "repo-then-pr") {
      setPickerRepo(null);
    }
  }

  function openRepoPicker() {
    setPickerMode("repo-then-pr");
    setPickerStep("repo");
    setPickerRepo(null);
    setIsPickerOpen(true);
  }

  function openRepoPullRequestPicker(repoNameWithOwner: string, repos: RepoSummary[]) {
    const repo = repos.find(
      (candidate) => candidate.nameWithOwner === repoNameWithOwner,
    );
    if (!repo) return;
    setPickerMode("pr-only");
    setPickerStep("pull-request");
    setPickerRepo(repo);
    setIsPickerOpen(true);
  }

  return {
    isPickerOpen,
    setIsPickerOpen,
    pickerMode,
    pickerStep,
    pickerRepo,
    debouncedQuery,
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
    setPickerStep,
    setPickerRepo,
  };
}
