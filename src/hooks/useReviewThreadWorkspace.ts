import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReviewThread } from "../lib/review-threads";
import {
  buildLocalReviewThreads,
  buildReviewThreadsByFile,
} from "../lib/review-threads";
import {
  addUserReviewNote,
  listReviewNotes,
  publishReviewNotes,
  type PublishedReview,
  type ReviewNote,
  type ReviewNoteOwner,
} from "../queries/local-checkouts-native";
import { pullRequestReviewThreadsQueryOptions } from "../queries/github";
import type {
  CreatePullRequestReviewCommentInput,
  SelectedPullRequestRevision,
} from "../types/github";

const IDLE_PULL_REQUEST_REVISION: SelectedPullRequestRevision = {
  repo: "__idle__",
  number: 0,
  headSha: "__idle__",
};
const PULL_REQUEST_REVIEW_SCOPE = "pull-request";

type UseReviewThreadWorkspaceArgs = {
  selectedPr: SelectedPullRequestRevision | null;
};

function draftOwner(
  selectedPr: SelectedPullRequestRevision,
): ReviewNoteOwner {
  return {
    kind: "pull_request_revision",
    repo: selectedPr.repo,
    number: selectedPr.number,
    headSha: selectedPr.headSha,
  };
}

export function useReviewThreadWorkspace({
  selectedPr,
}: UseReviewThreadWorkspaceArgs) {
  const queryClient = useQueryClient();
  const reviewThreadsQuery = useQuery({
    ...pullRequestReviewThreadsQueryOptions(
      selectedPr ?? IDLE_PULL_REQUEST_REVISION,
    ),
    enabled: selectedPr !== null,
  });
  const draftsQueryKey = [
    "review-notes",
    "pull-request",
    selectedPr?.repo,
    selectedPr?.number,
    selectedPr?.headSha,
  ] as const;
  const draftsQuery = useQuery({
    queryKey: draftsQueryKey,
    queryFn: () =>
      listReviewNotes(draftOwner(selectedPr!), PULL_REQUEST_REVIEW_SCOPE),
    enabled: selectedPr !== null,
    refetchInterval: 1_000,
    refetchIntervalInBackground: true,
  });

  const githubThreads =
    (reviewThreadsQuery.data as ReviewThread[] | undefined) ?? [];
  const draftThreads = useMemo(
    () => buildLocalReviewThreads(draftsQuery.data),
    [draftsQuery.data],
  );
  const draftCount =
    draftsQuery.data?.filter((note) => note.replyToId === null).length ?? 0;
  const reviewThreads = useMemo(
    () => [...githubThreads, ...draftThreads],
    [draftThreads, githubThreads],
  );
  const reviewThreadsByFile = useMemo(
    () => buildReviewThreadsByFile(reviewThreads),
    [reviewThreads],
  );

  const createDraftMutation = useMutation({
    mutationFn: async (input: CreatePullRequestReviewCommentInput) => {
      if (!selectedPr || input.line === null || input.side === null) {
        throw new Error("Pull request drafts require a target line.");
      }
      return addUserReviewNote({
        owner: draftOwner(selectedPr),
        scope: PULL_REQUEST_REVIEW_SCOPE,
        filePath: input.path,
        line: input.line,
        side: input.side === "LEFT" ? "deletions" : "additions",
        startLine: input.startLine,
        startSide: input.startSide
          ? input.startSide === "LEFT"
            ? "deletions"
            : "additions"
          : null,
        body: input.body,
      });
    },
    onSuccess: (note) => {
      queryClient.setQueryData<ReviewNote[]>(draftsQueryKey, (current) => [
        ...(current ?? []),
        note,
      ]);
    },
  });

  const publishDraftsMutation = useMutation({
    mutationFn: async (): Promise<PublishedReview> => {
      if (!selectedPr) throw new Error("No pull request is selected.");
      return publishReviewNotes(
        draftOwner(selectedPr),
        PULL_REQUEST_REVIEW_SCOPE,
      );
    },
    onSuccess: async () => {
      await Promise.all([draftsQuery.refetch(), reviewThreadsQuery.refetch()]);
    },
  });

  const error = [reviewThreadsQuery.error, draftsQuery.error]
    .filter(Boolean)
    .map((value) => (value instanceof Error ? value.message : String(value)))
    .join("\n");

  return {
    data: {
      draftCount,
      reviewThreads,
      reviewThreadsByFile,
    },
    status: {
      isLoading:
        selectedPr !== null &&
        ((reviewThreadsQuery.isPending && !reviewThreadsQuery.data) ||
          (draftsQuery.isPending && !draftsQuery.data)),
      error,
    },
    actions: {
      createComment: async (input: CreatePullRequestReviewCommentInput) => {
        await createDraftMutation.mutateAsync(input);
      },
      publishDrafts: () => publishDraftsMutation.mutateAsync(),
    },
    flags: {
      isCreateCommentPending: createDraftMutation.isPending,
      isPublishPending: publishDraftsMutation.isPending,
    },
    viewerLogin: null,
  };
}
