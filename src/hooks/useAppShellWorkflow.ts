import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  githubKeys,
  upsertTrackedPullRequest,
} from "../queries/github";
import {
  getPullRequestSummary,
  trackPullRequest,
} from "../queries/github-native";
import {
  getPullRequestRouteParams,
  PULL_REQUEST_ROUTE,
} from "../lib/pull-request-route";
import { usePullRequestPicker } from "./usePullRequestPicker";
import { useRepoPickerRepos } from "./useGithubQueries";
import { useRepoPersistence } from "./useRepoPersistence";
import { usePullRequestLinker } from "./usePullRequestLinker";
import { useTrackedPrRemover } from "./useTrackedPrRemover";
import type {
  PullRequestSummary,
  RepoSummary,
  SelectedPullRequestRef,
} from "../types/github";

type UseAppShellWorkflowArgs = {
  prsByRepo: Record<string, PullRequestSummary[]>;
  refreshRepo: (repo: string) => Promise<PullRequestSummary[]>;
  repos: RepoSummary[];
  selectedPr: SelectedPullRequestRef | null;
};

function useAppShellWorkflow({
  prsByRepo,
  refreshRepo,
  repos,
  selectedPr,
}: UseAppShellWorkflowArgs) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const picker = usePullRequestPicker();
  const { isSavingRepo, persistRepo, handlePickRepo } = useRepoPersistence();
  const {
    isOpeningPullRequestLink,
    manualEntryError,
    setManualEntryError,
    navigateToPullRequest,
    handleSubmitPullRequestLink,
  } = usePullRequestLinker({ selectedPr });
  const { handleRemoveTrackedPullRequest } = useTrackedPrRemover({ selectedPr });

  const [isTrackingPullRequest, setIsTrackingPullRequest] = useState(false);

  const { availableRepos, availableReposError, isLoadingRepos } =
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

  const trackedPrNumbersForPicker = useMemo(() => {
    if (!picker.pickerRepoName) return new Set<number>();
    const trackedPullRequests = prsByRepo[picker.pickerRepoName] ?? [];
    return new Set(trackedPullRequests.map((pullRequest) => pullRequest.number));
  }, [picker.pickerRepoName, prsByRepo]);

  const addablePullRequests = useMemo(
    () =>
      picker.pickerOpenPullRequests.filter(
        (pullRequest) => !trackedPrNumbersForPicker.has(pullRequest.number),
      ),
    [picker.pickerOpenPullRequests, trackedPrNumbersForPicker],
  );

  function handleSelectIssues() {
    void navigate({ to: "/issues" });
  }

  function handleSelectPr(repo: string, pullRequest: PullRequestSummary) {
    const params = getPullRequestRouteParams(repo, pullRequest.number);
    if (!params) return;
    void navigate({ params, to: PULL_REQUEST_ROUTE });
    void refreshRepo(repo);
  }

  async function handleTrackPullRequest(pullRequest: PullRequestSummary) {
    if (!picker.pickerRepoName) return;

    setIsTrackingPullRequest(true);
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
      picker.setIsPickerOpen(false);
      picker.resetPickerState();
    } finally {
      setIsTrackingPullRequest(false);
    }
  }

  async function handleSubmitManualPullRequestLink(link: string) {
    setManualEntryError(null);
    await handleSubmitPullRequestLink(link, persistRepo, () => {
      picker.setIsPickerOpen(false);
      picker.resetPickerState();
    });
  }

  async function handlePickRepoAndAdvance(repo: RepoSummary) {
    setManualEntryError(null);
    const savedRepo = await handlePickRepo(repo);
    picker.setPickerRepo(savedRepo);
    picker.setPickerStep("pull-request");
  }

  function handlePickerOpenChange(open: boolean) {
    picker.setIsPickerOpen(open);
    if (!open) {
      setManualEntryError(null);
      picker.resetPickerState();
    }
  }

  function handlePickerBack() {
    picker.setPickerStep("repo");
    picker.setPickerRepo(null);
  }

  return {
    addablePullRequests,
    availableReposError,
    filteredRepos,
    handlePickerBack,
    handlePickerOpenChange,
    handlePickRepo: handlePickRepoAndAdvance,
    handleRemoveTrackedPullRequest,
    handleSelectIssues,
    handleSelectPr,
    handleSubmitPullRequestLink: handleSubmitManualPullRequestLink,
    handleTrackPullRequest,
    isLoadingRepos,
    isOpeningPullRequestLink,
    isSavingRepo,
    isTrackingPullRequest,
    manualEntryError,
    picker,
  };
}

export { useAppShellWorkflow };
