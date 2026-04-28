import { useCallback } from "react";
import { type QueryKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReviewComment, ReviewThread } from "../lib/review-threads";
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

function createTemporaryId(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function createOptimisticComment(
  body: string,
  authorLogin: string,
  authorAvatarUrl: string | null,
  replyToId: string | null,
): ReviewComment {
  const timestamp = new Date().toISOString();

  return {
    id: createTemporaryId("temp-comment"),
    databaseId: null,
    authorLogin,
    authorAvatarUrl,
    authorAssociation: null,
    body,
    createdAt: timestamp,
    updatedAt: timestamp,
    url: "",
    replyToId,
    isPending: true,
    isOptimistic: true,
  };
}

function insertOptimisticThread(
  threads: ReviewThread[],
  thread: ReviewThread,
): ReviewThread[] {
  return [...threads, thread];
}

function appendOptimisticReply(
  threads: ReviewThread[],
  threadId: string,
  comment: ReviewComment,
): ReviewThread[] {
  return threads.map((thread) => {
    if (thread.id !== threadId) {
      return thread;
    }

    return {
      ...thread,
      comments: [...thread.comments, comment],
    };
  });
}

function updateOptimisticComment(
  threads: ReviewThread[],
  commentId: string,
  body: string,
): ReviewThread[] {
  const updatedAt = new Date().toISOString();

  return threads.map((thread) => ({
    ...thread,
    comments: thread.comments.map((comment) => {
      if (comment.id !== commentId) {
        return comment;
      }

      return {
        ...comment,
        body,
        updatedAt,
        isPending: true,
        isOptimistic: true,
      };
    }),
  }));
}

export function usePullRequestReviewCommentMutations(
  selectedPr: SelectedPullRequestRevision | null,
) {
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

  const invalidateReviewThreads = useCallback(async () => {
    if (!reviewThreadsQueryKey) {
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: reviewThreadsQueryKey,
    });
  }, [queryClient, reviewThreadsQueryKey]);

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

  function restoreOptimisticUpdate(context: {
    previousReviewThreads: ReviewThread[];
    reviewThreadsQueryKey: QueryKey;
  } | null) {
    if (!context) {
      return;
    }

    queryClient.setQueryData(
      context.reviewThreadsQueryKey,
      context.previousReviewThreads,
    );
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
      const optimisticThread: ReviewThread = {
        id: createTemporaryId("temp-thread"),
        path: input.path,
        isResolved: false,
        isOutdated: false,
        line: input.line,
        startLine: input.startLine,
        side: input.side,
        startSide: input.startSide,
        subjectType: input.subjectType,
        comments: [rootComment],
        isPending: true,
        isOptimistic: true,
      };

      queryClient.setQueryData<ReviewThread[]>(
        context.reviewThreadsQueryKey,
        insertOptimisticThread(context.previousReviewThreads, optimisticThread),
      );

      return context;
    },
    onError: (_error, _input, context) => {
      restoreOptimisticUpdate(context ?? null);
    },
    onSettled: invalidateReviewThreads,
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
        targetThread?.comments.find((comment) => comment.replyToId === null)?.id ??
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
    onSettled: invalidateReviewThreads,
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
    onSettled: invalidateReviewThreads,
  });

  return {
    createCommentMutation,
    replyCommentMutation,
    updateCommentMutation,
    viewerLogin: viewerLoginQuery.data?.login ?? null,
  };
}
