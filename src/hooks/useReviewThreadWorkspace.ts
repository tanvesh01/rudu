import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReviewThread } from "../lib/review-threads";
import {
  buildLocalReviewThreads,
  buildReviewThreadsByFile,
} from "../lib/review-threads";
import {
  addUserReviewCommentDraft,
  addUserReviewNote,
  listReviewNotes,
  promoteReviewNote,
  publishReviewNotes,
  type PublishedReview,
  type ReviewNote,
  type ReviewNoteOwner,
} from "../queries/local-checkouts-native";
import {
  pullRequestReviewThreadsQueryOptions,
  viewerLoginQueryOptions,
} from "../queries/github";
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
  const viewerLoginQuery = useQuery(viewerLoginQueryOptions());
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

  const githubThreads = useMemo(
    () =>
      ((reviewThreadsQuery.data as ReviewThread[] | undefined) ?? []).map(
        (thread) => ({ ...thread, source: "github" as const }),
      ),
    [reviewThreadsQuery.data],
  );
  const viewerLogin = viewerLoginQuery.data?.login ?? null;
  const localThreads = useMemo(
    () => buildLocalReviewThreads(draftsQuery.data, viewerLogin),
    [draftsQuery.data, viewerLogin],
  );
  const draftCount =
    draftsQuery.data?.filter(
      (note) => note.kind === "comment_draft" && note.replyToId === null,
    ).length ?? 0;
  const reviewThreads = useMemo(
    () => [...localThreads, ...githubThreads],
    [githubThreads, localThreads],
  );
  const reviewThreadsByFile = useMemo(
    () => buildReviewThreadsByFile(reviewThreads),
    [reviewThreads],
  );

  function annotationInput(input: CreatePullRequestReviewCommentInput) {
    if (!selectedPr || input.line === null || input.side === null) {
      throw new Error("Pull request annotations require a target line.");
    }
    return {
      owner: draftOwner(selectedPr),
      scope: PULL_REQUEST_REVIEW_SCOPE,
      filePath: input.path,
      line: input.line,
      side:
        input.side === "LEFT" ? ("deletions" as const) : ("additions" as const),
      startLine: input.startLine,
      startSide: input.startSide
        ? input.startSide === "LEFT"
          ? ("deletions" as const)
          : ("additions" as const)
        : null,
      body: input.body,
    };
  }

  const createNoteMutation = useMutation({
    mutationFn: (input: CreatePullRequestReviewCommentInput) =>
      addUserReviewNote(annotationInput(input)),
    onSuccess: addLocalAnnotation,
  });
  const createDraftMutation = useMutation({
    mutationFn: (input: CreatePullRequestReviewCommentInput) =>
      addUserReviewCommentDraft(annotationInput(input)),
    onSuccess: addLocalAnnotation,
  });

  function addLocalAnnotation(note: ReviewNote) {
    queryClient.setQueryData<ReviewNote[]>(draftsQueryKey, (current) => [
      ...(current ?? []),
      note,
    ]);
  }

  const promoteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      if (!selectedPr) throw new Error("No pull request is selected.");
      return promoteReviewNote(
        draftOwner(selectedPr),
        PULL_REQUEST_REVIEW_SCOPE,
        noteId,
      );
    },
    onSuccess: addLocalAnnotation,
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
      createNote: async (input: CreatePullRequestReviewCommentInput) => {
        await createNoteMutation.mutateAsync(input);
      },
      createComment: async (input: CreatePullRequestReviewCommentInput) => {
        await createDraftMutation.mutateAsync(input);
      },
      promoteNote: (noteId: string) => promoteNoteMutation.mutateAsync(noteId),
      publishDrafts: () => publishDraftsMutation.mutateAsync(),
    },
    flags: {
      isCreateCommentPending:
        createNoteMutation.isPending || createDraftMutation.isPending,
      isPublishPending: publishDraftsMutation.isPending,
    },
    viewerLogin,
  };
}
