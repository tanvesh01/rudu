import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReviewThread } from "../lib/review-threads";
import { buildReviewThreadsByFile } from "../lib/review-threads";
import { usePullRequestReviewCommentMutations } from "./usePullRequestReviewCommentMutations";
import {
  pullRequestReviewThreadsQueryOptions,
} from "../queries/github";
import type {
  CreatePullRequestReviewCommentInput,
  ReplyToPullRequestReviewCommentInput,
  SelectedPullRequestRevision,
  UpdatePullRequestReviewCommentInput,
} from "../types/github";

const IDLE_PULL_REQUEST_REVISION: SelectedPullRequestRevision = {
  repo: "__idle__",
  number: 0,
  headSha: "__idle__",
};

type UseReviewThreadWorkspaceArgs = {
  selectedPr: SelectedPullRequestRevision | null;
};

export function useReviewThreadWorkspace({
  selectedPr,
}: UseReviewThreadWorkspaceArgs) {
  const reviewThreadsQuery = useQuery({
    ...pullRequestReviewThreadsQueryOptions(
      selectedPr ?? IDLE_PULL_REQUEST_REVISION,
    ),
    enabled: selectedPr !== null,
  });

  const reviewThreads =
    (reviewThreadsQuery.data as ReviewThread[] | undefined) ?? [];

  const reviewThreadsByFile = useMemo(
    () => buildReviewThreadsByFile(reviewThreads),
    [reviewThreads],
  );

  const reviewCommentMutations = usePullRequestReviewCommentMutations({
    selectedPr,
  });

  return {
    data: {
      reviewThreads,
      reviewThreadsByFile,
    },
    status: {
      isLoading:
        selectedPr !== null &&
        (reviewThreadsQuery.isPending ||
          (reviewThreadsQuery.isFetching && !reviewThreadsQuery.data)),
      error:
        reviewThreadsQuery.error instanceof Error
          ? reviewThreadsQuery.error.message
          : String(reviewThreadsQuery.error ?? ""),
    },
    actions: {
      createComment: (input: CreatePullRequestReviewCommentInput) =>
        reviewCommentMutations.createCommentMutation.mutateAsync(input),
      replyToComment: (input: ReplyToPullRequestReviewCommentInput) =>
        reviewCommentMutations.replyCommentMutation.mutateAsync(input),
      updateComment: (input: UpdatePullRequestReviewCommentInput) =>
        reviewCommentMutations.updateCommentMutation.mutateAsync(input),
    },
    flags: {
      isCreateCommentPending:
        reviewCommentMutations.createCommentMutation.isPending,
    },
    viewerLogin: reviewCommentMutations.viewerLogin,
  };
}
