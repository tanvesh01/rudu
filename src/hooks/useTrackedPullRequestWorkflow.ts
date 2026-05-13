import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRepoPickerRepos, useTrackedPullRequests } from "./useGithubQueries";
import { usePullRequestPicker } from "./usePullRequestPicker";
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
import type {
  PullRequestSummary,
  RepoSummary,
  SelectedPullRequestRef,
} from "../types/github";

type ParsedPullRequestLink = {
  repo: string;
  number: number;
};

type UseTrackedPullRequestWorkflowArgs = {
  repos: RepoSummary[];
  setSelectedPr: Dispatch<SetStateAction<SelectedPullRequestRef | null>>;
};

function getAddableRepos(
  availableRepos: RepoSummary[],
  repos: RepoSummary[],
  query: string,
) {
  const addedRepoKeys = new Set(repos.map((repo) => repo.nameWithOwner));
  const addableRepos = availableRepos.filter(
    (repo) => !addedRepoKeys.has(repo.nameWithOwner),
  );

  return query.trim().length === 0 ? addableRepos.slice(0, 6) : addableRepos;
}

function getTrackedPullRequestNumbers(
  prsByRepo: Record<string, PullRequestSummary[]>,
  repoName: string | null,
) {
  if (!repoName) return new Set<number>();
  return new Set((prsByRepo[repoName] ?? []).map((pr) => pr.number));
}

function getAddablePullRequests(
  pullRequests: PullRequestSummary[],
  trackedNumbers: Set<number>,
) {
  return pullRequests.filter(
    (pullRequest) => !trackedNumbers.has(pullRequest.number),
  );
}

function parsePullRequestLink(input: string): ParsedPullRequestLink | null {
  const trimmedInput = input.trim();
  if (!trimmedInput) return null;

  const candidateUrl =
    trimmedInput.startsWith("http://") || trimmedInput.startsWith("https://")
      ? trimmedInput
      : `https://${trimmedInput}`;

  try {
    const url = new URL(candidateUrl);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
      return null;
    }

    const [owner, repoName, resource, numberSegment] = url.pathname
      .split("/")
      .filter(Boolean);
    if (!owner || !repoName || resource !== "pull") {
      return null;
    }

    const number = Number(numberSegment);
    if (!Number.isInteger(number) || number <= 0) {
      return null;
    }

    return {
      repo: `${owner}/${repoName}`,
      number,
    };
  } catch {
    return null;
  }
}

export function useTrackedPullRequestWorkflow({
  repos,
  setSelectedPr,
}: UseTrackedPullRequestWorkflowArgs) {
  const queryClient = useQueryClient();
  const [isSavingRepo, setIsSavingRepo] = useState(false);
  const [isOpeningPullRequestLink, setIsOpeningPullRequestLink] =
    useState(false);
  const [isTrackingPullRequest, setIsTrackingPullRequest] = useState(false);
  const [manualEntryError, setManualEntryError] = useState<string | null>(null);

  const { prsByRepo, repoErrors, refreshTrackedPullRequests } =
    useTrackedPullRequests({
      repos,
    });
  const picker = usePullRequestPicker({ repos });
  const { availableRepos, availableReposError, isLoadingRepos } =
    useRepoPickerRepos(
      picker.debouncedQuery,
      picker.isPickerOpen && picker.pickerStep === "repo",
    );

  const filteredRepos = useMemo(
    () => getAddableRepos(availableRepos, repos, picker.debouncedQuery),
    [availableRepos, repos, picker.debouncedQuery],
  );

  const trackedPullRequestNumbers = useMemo(
    () => getTrackedPullRequestNumbers(prsByRepo, picker.pickerRepoName),
    [picker.pickerRepoName, prsByRepo],
  );

  const addablePullRequests = useMemo(
    () =>
      getAddablePullRequests(
        picker.pickerOpenPullRequests,
        trackedPullRequestNumbers,
      ),
    [picker.pickerOpenPullRequests, trackedPullRequestNumbers],
  );

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

  function closePicker() {
    picker.setIsPickerOpen(false);
    picker.resetPickerState();
  }

  async function trackAndSelectPullRequest(
    repo: string,
    pullRequest: PullRequestSummary,
  ) {
    const trackedPullRequest = await trackPullRequest(repo, pullRequest);
    queryClient.setQueryData<PullRequestSummary[]>(
      githubKeys.trackedPullRequestList(repo),
      (current) => upsertTrackedPullRequest(current, trackedPullRequest),
    );
    setSelectedPr({
      repo,
      number: trackedPullRequest.number,
    });
    closePicker();
    return trackedPullRequest;
  }

  async function handlePickRepo(repo: RepoSummary) {
    setManualEntryError(null);
    setIsSavingRepo(true);
    try {
      const savedRepo = await persistRepo(repo);
      picker.selectRepo(savedRepo);
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
      await trackAndSelectPullRequest(savedRepo.nameWithOwner, pullRequest);
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
      await trackAndSelectPullRequest(picker.pickerRepoName, pullRequest);
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

    setSelectedPr((current) => {
      if (!current) return current;
      if (current.repo !== repo || current.number !== pullRequest.number) {
        return current;
      }
      return null;
    });
  }

  function handlePickerOpenChange(open: boolean) {
    picker.setIsPickerOpen(open);
    if (open) return;
    setManualEntryError(null);
    picker.resetPickerState();
  }

  return {
    prsByRepo,
    repoErrors,
    refreshTrackedPullRequests,
    openRepoPicker: picker.openRepoPicker,
    openRepoPullRequestPicker: picker.openRepoPullRequestPicker,
    removeTrackedPullRequest: handleRemoveTrackedPullRequest,
    picker: {
      open: picker.isPickerOpen,
      onOpenChange: handlePickerOpenChange,
      mode: picker.pickerMode,
      step: picker.pickerStep,
      selectedRepo: picker.pickerRepo,
      onSearchChange: picker.updateSearch,
      isLoadingRepos,
      availableReposError,
      filteredRepos,
      isSubmittingRepo: isSavingRepo || isOpeningPullRequestLink,
      manualRepoError: manualEntryError,
      onPickRepo: handlePickRepo,
      onSubmitManualRepo: handleSubmitPullRequestLink,
      pullRequests: addablePullRequests,
      isLoadingPullRequests: picker.isLoadingPullRequests,
      pullRequestsError: picker.pickerPullRequestsError,
      isTrackingPullRequest,
      onPickPullRequest: handleTrackPullRequest,
      onBack: picker.goBackToRepoStep,
    },
  };
}

export {
  getAddablePullRequests,
  getAddableRepos,
  getTrackedPullRequestNumbers,
  parsePullRequestLink,
};
