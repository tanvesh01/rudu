import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  githubKeys,
  upsertTrackedPullRequest,
} from "../queries/github";
import {
  getPullRequestSummary,
  trackPullRequest,
  validateRepo,
} from "../queries/github-native";
import {
  getPullRequestRouteParams,
  parsePullRequestLink,
  PULL_REQUEST_ROUTE,
} from "../lib/pull-request-route";
import type { PullRequestSummary, SelectedPullRequestRef } from "../types/github";

type UsePullRequestLinkerArgs = {
  selectedPr: SelectedPullRequestRef | null;
};

export function usePullRequestLinker({ selectedPr }: UsePullRequestLinkerArgs) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isOpeningPullRequestLink, setIsOpeningPullRequestLink] =
    useState(false);
  const [manualEntryError, setManualEntryError] = useState<string | null>(null);

  function navigateToPullRequest(repo: string, number: number) {
    const params = getPullRequestRouteParams(repo, number);
    if (!params) return;

    void navigate({
      params,
      to: PULL_REQUEST_ROUTE,
    });
  }

  async function handleSubmitPullRequestLink(
    pullRequestLink: string,
    persistRepo: (repo: { nameWithOwner: string }) => Promise<{ nameWithOwner: string }>,
    onSuccess?: () => void,
  ) {
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
      onSuccess?.();
    } catch (error) {
      setManualEntryError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setIsOpeningPullRequestLink(false);
    }
  }

  return {
    isOpeningPullRequestLink,
    manualEntryError,
    setManualEntryError,
    navigateToPullRequest,
    handleSubmitPullRequestLink,
  };
}
