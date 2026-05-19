import {
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ReviewThread } from "../lib/review-threads";
import {
  appendOptimisticReply,
  createOptimisticComment,
  createOptimisticThread,
  insertOptimisticThread,
  updateOptimisticComment,
} from "../lib/review-thread-optimistic";
import {
  createPullRequestReviewComment,
  githubKeys,
  replyToPullRequestReviewComment,
  updatePullRequestReviewComment,
  viewerLoginQueryOptions,
} from "../queries/github";
import type {
  CreatePullRequestReviewCommentInput,
  ReplyToPullRequestReviewCommentInput,
  SelectedPullRequestRevision,
  UpdatePullRequestReviewCommentInput,
} from "../types/github";

type UsePullRequestReviewCommentMutationsArgs = {
  selectedPr: SelectedPullRequestRevision | null;
};

type OptimisticUpdateContext = {
  previousReviewThreads: ReviewThread[];
  reviewThreadsQueryKey: QueryKey;
};

export function usePullRequestReviewCommentMutations({
  selectedPr,
}: UsePullRequestReviewCommentMutationsArgs) {
  const queryClient = useQueryClient();
  const viewerLoginQuery = useQuery(viewerLoginQueryOptions());
  const viewerLogin = viewerLoginQuery.data?.login ?? null;
  const optimisticViewerLogin = viewerLogin ?? "You";
  const viewerAvatarUrl = viewerLogin
    ? `https://github.com/${viewerLogin}.png?size=96`
    : null;

  const reviewThreadsQueryKey = selectedPr
    ? githubKeys.pullRequestReviewThreads(selectedPr)
    : null;

  async function prepareOptimisticUpdate() {
    if (!reviewThreadsQueryKey) {
      return null;
    }

    await queryClient.cancelQueries({ queryKey: reviewThreadsQueryKey });

    return {
      previousReviewThreads:
        queryClient.getQueryData<ReviewThread[]>(reviewThreadsQueryKey) ?? [],
      reviewThreadsQueryKey,
    };
  }

  function restoreOptimisticUpdate(context: OptimisticUpdateContext | null) {
    if (!context) {
      return;
    }

    queryClient.setQueryData(
      context.reviewThreadsQueryKey,
      context.previousReviewThreads,
    );
  }

  async function refetchReviewThreads(context: OptimisticUpdateContext | null) {
    if (!context) {
      return;
    }

    await queryClient.refetchQueries({
      queryKey: context.reviewThreadsQueryKey,
    });
  }

  const createCommentMutation = useMutation({
    mutationFn: (input: CreatePullRequestReviewCommentInput) =>
      createPullRequestReviewComment(input),
    onMutate: async (input) => {
      const context = await prepareOptimisticUpdate();
      if (!context) {
        return null;
      }

      const rootComment = createOptimisticComment(
        input.body,
        optimisticViewerLogin,
        viewerAvatarUrl,
        null,
      );
      const optimisticThread = createOptimisticThread(input, rootComment);

      queryClient.setQueryData<ReviewThread[]>(
        context.reviewThreadsQueryKey,
        insertOptimisticThread(context.previousReviewThreads, optimisticThread),
      );

      return context;
    },
    onError: (_error, _input, context) => {
      restoreOptimisticUpdate(context ?? null);
    },
    onSettled: (_data, _error, _input, context) =>
      refetchReviewThreads(context ?? null),
  });

  const replyCommentMutation = useMutation({
    mutationFn: (input: ReplyToPullRequestReviewCommentInput) =>
      replyToPullRequestReviewComment(input),
    onMutate: async (input) => {
      const context = await prepareOptimisticUpdate();
      if (!context) {
        return null;
      }

      const targetThread = context.previousReviewThreads.find(
        (thread) => thread.id === input.threadId,
      );
      const rootCommentId =
        targetThread?.comments.find((comment) => comment.replyToId === null)
          ?.id ??
        targetThread?.comments[0]?.id ??
        null;
      const optimisticReply = createOptimisticComment(
        input.body,
        optimisticViewerLogin,
        viewerAvatarUrl,
        rootCommentId,
      );

      queryClient.setQueryData<ReviewThread[]>(
        context.reviewThreadsQueryKey,
        appendOptimisticReply(
          context.previousReviewThreads,
          input.threadId,
          optimisticReply,
        ),
      );

      return context;
    },
    onError: (_error, _input, context) => {
      restoreOptimisticUpdate(context ?? null);
    },
    onSettled: (_data, _error, _input, context) =>
      refetchReviewThreads(context ?? null),
  });

  const updateCommentMutation = useMutation({
    mutationFn: (input: UpdatePullRequestReviewCommentInput) =>
      updatePullRequestReviewComment(input),
    onMutate: async (input) => {
      const context = await prepareOptimisticUpdate();
      if (!context) {
        return null;
      }

      queryClient.setQueryData<ReviewThread[]>(
        context.reviewThreadsQueryKey,
        updateOptimisticComment(
          context.previousReviewThreads,
          input.commentId,
          input.body,
        ),
      );

      return context;
    },
    onError: (_error, _input, context) => {
      restoreOptimisticUpdate(context ?? null);
    },
    onSettled: (_data, _error, _input, context) =>
      refetchReviewThreads(context ?? null),
  });

  return {
    createCommentMutation,
    replyCommentMutation,
    updateCommentMutation,
    viewerLogin: viewerLoginQuery.data?.login ?? null,
  };
}
