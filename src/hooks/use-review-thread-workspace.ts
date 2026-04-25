import { useCallback, useMemo } from "react";
import {
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { ReviewThread } from "../lib/review-threads";
import { buildReviewThreadsByFile } from "../lib/review-threads";
import {
  appendOptimisticReply,
  createOptimisticComment,
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
  UpdatePullRequestReviewCommentInput,
} from "../types/github";

export type ReviewThreadWorkspaceArgs = {
  repo: string;
  prNumber: number;
  headSha: string;
} | null;

export type ReviewThreadWorkspace = {
  viewByFile: ReturnType<typeof buildReviewThreadsByFile>;
  allThreads: ReviewThread[];
  actions: {
    createComment(input: CreatePullRequestReviewCommentInput): Promise<void>;
    reply(input: ReplyToPullRequestReviewCommentInput): Promise<void>;
    update(input: UpdatePullRequestReviewCommentInput): Promise<void>;
  };
  status: {
    isLoading: boolean;
    error: string;
    viewerLogin: string | null;
  };
};

function createOptimisticThread(
  input: CreatePullRequestReviewCommentInput,
  viewerLogin: string,
): ReviewThread {
  const rootComment = createOptimisticComment(input.body, viewerLogin, null);

  return {
    id: `temp-thread:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
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
}

export function useReviewThreadWorkspace(
  args: ReviewThreadWorkspaceArgs,
): ReviewThreadWorkspace {
  const queryClient = useQueryClient();

  const reviewThreadsQueryKey: QueryKey | null = args
    ? githubKeys.pullRequestReviewThreads({
        repo: args.repo,
        number: args.prNumber,
        headSha: args.headSha,
      })
    : null;

  const reviewThreadsQuery = useQuery({
    queryKey: reviewThreadsQueryKey ?? githubKeys.pullRequestReviewThreadsIdle(),
    queryFn: () => {
      if (!args) {
        throw new Error("No pull request selected");
      }

      return invoke<ReviewThread[]>("get_pull_request_review_threads", {
        repo: args.repo,
        number: args.prNumber,
      });
    },
    enabled: args !== null,
  });

  const viewerLoginQuery = useQuery(viewerLoginQueryOptions());
  const viewerLogin = viewerLoginQuery.data?.login ?? "You";

  const allThreads =
    (reviewThreadsQuery.data as ReviewThread[] | undefined) ?? [];

  const viewByFile = useMemo(
    () => buildReviewThreadsByFile(allThreads),
    [allThreads],
  );

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

  function restoreOptimisticUpdate(
    context: {
      previousReviewThreads: ReviewThread[];
      reviewThreadsQueryKey: QueryKey;
    } | null,
  ) {
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

      const optimisticThread = createOptimisticThread(input, viewerLogin);

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
        targetThread?.comments.find((comment) => comment.replyToId === null)
          ?.id ??
        targetThread?.comments[0]?.id ??
        null;
      const optimisticReply = createOptimisticComment(
        input.body,
        viewerLogin,
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

  const createComment = useCallback(
    async (input: CreatePullRequestReviewCommentInput) => {
      await createCommentMutation.mutateAsync(input);
    },
    [createCommentMutation],
  );

  const reply = useCallback(
    async (input: ReplyToPullRequestReviewCommentInput) => {
      await replyCommentMutation.mutateAsync(input);
    },
    [replyCommentMutation],
  );

  const update = useCallback(
    async (input: UpdatePullRequestReviewCommentInput) => {
      await updateCommentMutation.mutateAsync(input);
    },
    [updateCommentMutation],
  );

  return {
    viewByFile,
    allThreads,
    actions: { createComment, reply, update },
    status: {
      isLoading:
        args !== null &&
        (reviewThreadsQuery.isPending ||
          (reviewThreadsQuery.isFetching && !reviewThreadsQuery.data)),
      error: reviewThreadsQuery.error
        ? reviewThreadsQuery.error instanceof Error
          ? reviewThreadsQuery.error.message
          : String(reviewThreadsQuery.error)
        : "",
      viewerLogin: viewerLoginQuery.data?.login ?? null,
    },
  };
}
