import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  githubKeys,
  savedReposQueryOptions,
  upsertTrackedPullRequest,
} from "../queries/github";
import {
  getPullRequestSummary,
  removeTrackedPullRequest,
  saveRepo,
  trackPullRequest,
  validateRepo,
} from "../queries/github-native";
import {
  getPullRequestRouteParams,
  parsePullRequestLink,
  PULL_REQUEST_ROUTE,
} from "../lib/pull-request-route";
import { usePullRequestPicker } from "./usePullRequestPicker";
import { useRepoPickerRepos } from "./useGithubQueries";
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
  const [isSavingRepo, setIsSavingRepo] = useState(false);
  const [isOpeningPullRequestLink, setIsOpeningPullRequestLink] =
    useState(false);
  const [isTrackingPullRequest, setIsTrackingPullRequest] = useState(false);
  const [manualEntryError, setManualEntryError] = useState<string | null>(null);

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

  function navigateToPullRequest(repo: string, number: number) {
    const params = getPullRequestRouteParams(repo, number);
    if (!params) return;

    void navigate({
      params,
      to: PULL_REQUEST_ROUTE,
    });
  }

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

  function handleSelectIssues() {
    void navigate({ to: "/issues" });
  }

  function handleSelectPr(repo: string, pullRequest: PullRequestSummary) {
    navigateToPullRequest(repo, pullRequest.number);
    void refreshRepo(repo);
  }

  async function handlePickRepo(repo: RepoSummary) {
    setManualEntryError(null);
    setIsSavingRepo(true);
    try {
      const savedRepo = await persistRepo(repo);
      picker.setPickerRepo(savedRepo);
      picker.setPickerStep("pull-request");
    } finally {
      setIsSavingRepo(false);
    }
  }

  async function handleSubmitPullRequestLink(pullRequestLink: string) {
    const parsedPullRequestLink = parsePullRequestLink(pullRequestLink);
    if (!parsedPullRequestLink) {
      setManualEntryError(
        "Paste a GitHub PR link like github.com/owner/repo/pull/123.",
      );
      return;
    }

    setManualEntryError(null);
    setIsOpeningPullRequestLink(true);
    try {
      const validatedRepo = await validateRepo(parsedPullRequestLink.repo);
      const savedRepo = await persistRepo(validatedRepo);
      const pullRequest = await getPullRequestSummary({
        repo: savedRepo.nameWithOwner,
        number: parsedPullRequestLink.number,
      });
      const trackedPullRequest = await trackPullRequest(
        savedRepo.nameWithOwner,
        pullRequest,
      );
      queryClient.setQueryData<PullRequestSummary[]>(
        githubKeys.trackedPullRequestList(savedRepo.nameWithOwner),
        (current) => upsertTrackedPullRequest(current, trackedPullRequest),
      );
      navigateToPullRequest(savedRepo.nameWithOwner, trackedPullRequest.number);
      picker.setIsPickerOpen(false);
      picker.resetPickerState();
    } catch (error) {
      setManualEntryError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setIsOpeningPullRequestLink(false);
    }
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

      navigateToPullRequest(picker.pickerRepoName, trackedPullRequest.number);
      picker.setIsPickerOpen(false);
      picker.resetPickerState();
    } finally {
      setIsTrackingPullRequest(false);
    }
  }

  async function handleRemoveTrackedPullRequest(
    repo: string,
    pullRequest: PullRequestSummary,
  ) {
    await removeTrackedPullRequest(repo, pullRequest.number);
    queryClient.setQueryData<PullRequestSummary[]>(
      githubKeys.trackedPullRequestList(repo),
      (current) =>
        (current ?? []).filter((item) => item.number !== pullRequest.number),
    );

    if (selectedPr?.repo === repo && selectedPr.number === pullRequest.number) {
      void navigate({ to: "/" });
    }
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
    handlePickRepo,
    handleRemoveTrackedPullRequest,
    handleSelectIssues,
    handleSelectPr,
    handleSubmitPullRequestLink,
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
