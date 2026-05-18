import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { githubKeys } from "../queries/github";
import { removeTrackedPullRequest } from "../queries/github-native";
import type { PullRequestSummary, SelectedPullRequestRef } from "../types/github";

type UseTrackedPrRemoverArgs = {
  selectedPr: SelectedPullRequestRef | null;
};

export function useTrackedPrRemover({ selectedPr }: UseTrackedPrRemoverArgs) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  return { handleRemoveTrackedPullRequest };
}
