import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  githubKeys,
  upsertTrackedPullRequest,
} from "../queries/github";
import { trackPullRequest } from "../queries/github-native";
import {
  getPullRequestRouteParams,
  PULL_REQUEST_ROUTE,
} from "../lib/pull-request-route";
import { usePullRequestPicker } from "./usePullRequestPicker";
import { useRepoPickerRepos } from "./useGithubQueries";
import { useRepoPersistence } from "./useRepoPersistence";
import { usePullRequestLinker } from "./usePullRequestLinker";
import { usePickerWorkflowStore } from "../stores";
import type {
  PullRequestSummary,
  RepoSummary,
} from "../types/github";

function useAppShellWorkflow({ repos }: { repos: RepoSummary[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const picker = usePullRequestPicker();

  const {
    isSavingRepo,
    isOpeningPullRequestLink,
    isTrackingPullRequest,
    manualEntryError,
  } = picker;

  const storeActions = usePickerWorkflowStore.getState().actions;

  const { persistRepo, handlePickRepo } = useRepoPersistence();
  const { handleSubmitPullRequestLink, openPullRequest } =
    usePullRequestLinker({ persistRepo });

  const {
    availableRepos,
    availableReposError,
    availableReposWarning,
    isLoadingRepos,
  } =
    useRepoPickerRepos(
      picker.debouncedQuery,
      picker.isPickerOpen && picker.pickerStep === "repo",
    );

  const addedRepoKeys = useMemo(
    () => new Set(repos.map((repo) => repo.nameWithOwner)),
    [repos],
  );

  const filteredRepos = useMemo(() => {
    const addableRepos = availableRepos.filter(
      (repo) => !addedRepoKeys.has(repo.nameWithOwner),
    );

    return picker.debouncedQuery.trim().length === 0
      ? addableRepos.slice(0, 6)
      : addableRepos;
  }, [addedRepoKeys, availableRepos, picker.debouncedQuery]);

  const addablePullRequests = picker.pickerOpenPullRequests;

  async function handlePickRepoAndAdvance(repo: RepoSummary) {
    storeActions.manualEntryCleared();
    const savedRepo = await handlePickRepo(repo);
    picker.actions.pickerRepoChanged(savedRepo);
    picker.actions.pickerStepChanged("pull-request");
  }

  async function handleSubmitManualPullRequestLink(link: string) {
    storeActions.manualEntryCleared();
    await handleSubmitPullRequestLink(link, () => {
      picker.actions.pickerOpenChanged(false);
      picker.resetPickerState();
    });
  }

  async function handleTrackPullRequest(pullRequest: PullRequestSummary) {
    if (!picker.pickerRepoName) return;

    storeActions.pullRequestTrackingStarted();
    try {
      const trackedPullRequest = await trackPullRequest(
        picker.pickerRepoName,
        pullRequest,
      );
      queryClient.setQueryData<PullRequestSummary[]>(
        githubKeys.trackedPullRequestList(picker.pickerRepoName),
        (current) => upsertTrackedPullRequest(current, trackedPullRequest),
      );

      const params = getPullRequestRouteParams(
        picker.pickerRepoName,
        trackedPullRequest.number,
      );
      if (params) {
        void navigate({ params, to: PULL_REQUEST_ROUTE });
      }
      picker.actions.pickerOpenChanged(false);
      picker.resetPickerState();
    } finally {
      storeActions.pullRequestTrackingCompleted();
    }
  }

  function handlePickerOpenChange(open: boolean) {
    picker.actions.pickerOpenChanged(open);
    if (!open) {
      storeActions.manualEntryCleared();
      picker.resetPickerState();
    }
  }

  function handlePickerBack() {
    picker.actions.pickerStepChanged("repo");
    picker.actions.pickerRepoChanged(null);
  }

  return {
    addablePullRequests,
    availableReposError,
    availableReposWarning,
    filteredRepos,
    handlePickerBack,
    handlePickerOpenChange,
    handlePickRepo: handlePickRepoAndAdvance,
    handleSubmitPullRequestLink: handleSubmitManualPullRequestLink,
    handleTrackPullRequest,
    isLoadingRepos,
    isOpeningPullRequestLink,
    isSavingRepo,
    isTrackingPullRequest,
    manualEntryError,
    openPullRequest,
    picker,
  };
}

export { useAppShellWorkflow };
