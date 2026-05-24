import { createOptimisticAction } from "@tanstack/db";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
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

  const queryKey = selectedPr
    ? githubKeys.selectedPullRequestReviewThreads(selectedPr)
    : null;

  // Refs for values that change — read inside stable callbacks
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;
  const viewerLoginRef = useRef(optimisticViewerLogin);
  viewerLoginRef.current = optimisticViewerLogin;
  const avatarUrlRef = useRef(viewerAvatarUrl);
  avatarUrlRef.current = viewerAvatarUrl;
  const previousRef = useRef<ReviewThread[]>([]);

  // Pending state
  const [isCreatePending, setIsCreatePending] = useState(false);
  const [isReplyPending, setIsReplyPending] = useState(false);
  const [isUpdatePending, setIsUpdatePending] = useState(false);

  // Create stable optimistic action functions (capture stable queryClient + refs)
  const createCommentAction = useMemo(
    () =>
      createOptimisticAction<CreatePullRequestReviewCommentInput>({
        onMutate: (input) => {
          const key = queryKeyRef.current;
          if (!key) return;
          const previous =
            queryClient.getQueryData<ReviewThread[]>(key) ?? [];
          previousRef.current = previous;
          const rootComment = createOptimisticComment(
            input.body,
            viewerLoginRef.current,
            avatarUrlRef.current,
            null,
          );
          const optimisticThread = createOptimisticThread(input, rootComment);
          queryClient.setQueryData<ReviewThread[]>(
            key,
            insertOptimisticThread(previous, optimisticThread),
          );
        },
        mutationFn: async (input) => {
          const key = queryKeyRef.current;
          if (!key) throw new Error("No PR selected");
          try {
            await createPullRequestReviewComment(input);
            await queryClient.refetchQueries({ queryKey: key });
          } catch (error) {
            queryClient.setQueryData(key, previousRef.current);
            throw error;
          }
        },
      }),
    [],
  );

  const replyCommentAction = useMemo(
    () =>
      createOptimisticAction<ReplyToPullRequestReviewCommentInput>({
        onMutate: (input) => {
          const key = queryKeyRef.current;
          if (!key) return;
          const previous =
            queryClient.getQueryData<ReviewThread[]>(key) ?? [];
          previousRef.current = previous;
          const targetThread = previous.find(
            (thread) => thread.id === input.threadId,
          );
          const rootCommentId =
            targetThread?.comments.find((comment) => comment.replyToId === null)
              ?.id ??
            targetThread?.comments[0]?.id ??
            null;
          const optimisticReply = createOptimisticComment(
            input.body,
            viewerLoginRef.current,
            avatarUrlRef.current,
            rootCommentId,
          );
          queryClient.setQueryData<ReviewThread[]>(
            key,
            appendOptimisticReply(previous, input.threadId, optimisticReply),
          );
        },
        mutationFn: async (input) => {
          const key = queryKeyRef.current;
          if (!key) throw new Error("No PR selected");
          try {
            await replyToPullRequestReviewComment(input);
            await queryClient.refetchQueries({ queryKey: key });
          } catch (error) {
            queryClient.setQueryData(key, previousRef.current);
            throw error;
          }
        },
      }),
    [],
  );

  const updateCommentAction = useMemo(
    () =>
      createOptimisticAction<UpdatePullRequestReviewCommentInput>({
        onMutate: (input) => {
          const key = queryKeyRef.current;
          if (!key) return;
          const previous =
            queryClient.getQueryData<ReviewThread[]>(key) ?? [];
          previousRef.current = previous;
          queryClient.setQueryData<ReviewThread[]>(
            key,
            updateOptimisticComment(previous, input.commentId, input.body),
          );
        },
        mutationFn: async (input) => {
          const key = queryKeyRef.current;
          if (!key) throw new Error("No PR selected");
          try {
            await updatePullRequestReviewComment(input);
            await queryClient.refetchQueries({ queryKey: key });
          } catch (error) {
            queryClient.setQueryData(key, previousRef.current);
            throw error;
          }
        },
      }),
    [],
  );

  // Wrap with mutateAsync + pending tracking
  const createCommentMutation = {
    mutateAsync: useCallback(
      async (input: CreatePullRequestReviewCommentInput) => {
        if (!queryKeyRef.current) throw new Error("No PR selected");
        setIsCreatePending(true);
        try {
          const tx = createCommentAction(input);
          await tx.isPersisted.promise;
        } finally {
          setIsCreatePending(false);
        }
      },
      [createCommentAction],
    ),
    isPending: isCreatePending,
  };

  const replyCommentMutation = {
    mutateAsync: useCallback(
      async (input: ReplyToPullRequestReviewCommentInput) => {
        if (!queryKeyRef.current) throw new Error("No PR selected");
        setIsReplyPending(true);
        try {
          const tx = replyCommentAction(input);
          await tx.isPersisted.promise;
        } finally {
          setIsReplyPending(false);
        }
      },
      [replyCommentAction],
    ),
    isPending: isReplyPending,
  };

  const updateCommentMutation = {
    mutateAsync: useCallback(
      async (input: UpdatePullRequestReviewCommentInput) => {
        if (!queryKeyRef.current) throw new Error("No PR selected");
        setIsUpdatePending(true);
        try {
          const tx = updateCommentAction(input);
          await tx.isPersisted.promise;
        } finally {
          setIsUpdatePending(false);
        }
      },
      [updateCommentAction],
    ),
    isPending: isUpdatePending,
  };

  return {
    createCommentMutation,
    replyCommentMutation,
    updateCommentMutation,
    viewerLogin: viewerLoginQuery.data?.login ?? null,
  };
}
