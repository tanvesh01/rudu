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
import { usePickerWorkflowStore } from "../stores";
import type { PullRequestSummary, RepoSummary } from "../types/github";

type UsePullRequestLinkerArgs = {
  persistRepo: (repo: RepoSummary) => Promise<RepoSummary>;
};

export function usePullRequestLinker({ persistRepo }: UsePullRequestLinkerArgs) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const storeActions = usePickerWorkflowStore.getState().actions;

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
    onSuccess?: () => void,
  ) {
    const parsedPullRequestLink = parsePullRequestLink(pullRequestLink);
    if (!parsedPullRequestLink) {
      storeActions.manualEntryFailed(
        "Paste a GitHub PR link like github.com/owner/repo/pull/123.",
      );
      return;
    }

    storeActions.manualEntryCleared();
    storeActions.pullRequestLinkOpenStarted();
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
      storeActions.manualEntryFailed(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      storeActions.pullRequestLinkOpenCompleted();
    }
  }

  return {
    navigateToPullRequest,
    handleSubmitPullRequestLink,
  };
}
