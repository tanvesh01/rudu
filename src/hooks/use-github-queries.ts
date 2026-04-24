import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  type QueryKey,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ReviewComment, ReviewThread } from "../lib/review-threads";
import {
  createPullRequestReviewComment,
  githubKeys,
  initialReposQueryOptions,
  replyToPullRequestReviewComment,
  savedReposQueryOptions,
  searchReposQueryOptions,
  trackedPullRequestListQueryOptions,
  updatePullRequestReviewComment,
  viewerLoginQueryOptions,
} from "../queries/github";
import type {
  CreatePullRequestReviewCommentInput,
  PrPatch,
  PullRequestSummary,
  ReplyToPullRequestReviewCommentInput,
  RepoSummary,
  SelectedPullRequest,
  UpdatePullRequestReviewCommentInput,
} from "../types/github";

function getErrorMessage(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  return String(error);
}

function createTemporaryId(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function createOptimisticComment(
  body: string,
  authorLogin: string,
  replyToId: string | null,
): ReviewComment {
  const timestamp = new Date().toISOString();

  return {
    id: createTemporaryId("temp-comment"),
    databaseId: null,
    authorLogin,
    authorAvatarUrl: null,
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

function useSavedRepos() {
  const query = useQuery(savedReposQueryOptions());
  return {
    ...query,
    repos: query.data ?? [],
  };
}

function useRepoPickerRepos(debouncedQuery: string) {
  const queryClient = useQueryClient();
  const trimmedQuery = debouncedQuery.trim();

  const { data: initialRepos = [], isPending: isInitialLoading } = useQuery(
    initialReposQueryOptions(),
  );

  const {
    data: searchRepos = [],
    error: searchError,
    isPending: isSearchLoading,
  } = useQuery({
    ...searchReposQueryOptions(debouncedQuery),
    enabled: trimmedQuery.length > 0,
  });

  useEffect(() => {
    void queryClient.prefetchQuery(initialReposQueryOptions());
  }, [queryClient]);

  const availableRepos = trimmedQuery.length > 0 ? searchRepos : initialRepos;
  const isLoadingRepos = trimmedQuery.length > 0 ? isSearchLoading : isInitialLoading;

  return {
    availableRepos,
    availableReposError: searchError,
    isLoadingRepos,
  };
}

type UseRepoPullRequestsArgs = {
  repos: RepoSummary[];
  setSelectedPr: Dispatch<SetStateAction<SelectedPullRequest | null>>;
};

function useTrackedPullRequests({
  repos,
  setSelectedPr,
}: UseRepoPullRequestsArgs) {
  const queryClient = useQueryClient();
  const repoNames = useMemo(
    () => repos.map((repo) => repo.nameWithOwner),
    [repos],
  );

  const trackedPullRequestQueries = useQueries({
    queries: repoNames.map((repo) => ({
      ...trackedPullRequestListQueryOptions(repo),
      staleTime: Infinity,
    })),
  });

  const prsByRepo = useMemo(() => {
    const entries: Array<[string, PullRequestSummary[]]> = [];
    for (let i = 0; i < repoNames.length; i += 1) {
      const repo = repoNames[i];
      const pullRequests = trackedPullRequestQueries[i]?.data;
      if (!pullRequests) continue;
      entries.push([repo, pullRequests]);
    }
    return Object.fromEntries(entries);
  }, [repoNames, trackedPullRequestQueries]);

  const repoErrors = useMemo(() => {
    const entries: Array<[string, string]> = [];
    for (let i = 0; i < repoNames.length; i += 1) {
      const repo = repoNames[i];
      const error = trackedPullRequestQueries[i]?.error;
      if (!error) continue;
      entries.push([repo, getErrorMessage(error)]);
    }
    return Object.fromEntries(entries);
  }, [repoNames, trackedPullRequestQueries]);

  const refreshTrackedPullRequests = useCallback(
    async (repo: string) => {
      try {
        const pullRequests = await invoke<PullRequestSummary[]>(
          "refresh_tracked_pull_requests",
          { repo },
        );

        queryClient.setQueryData<PullRequestSummary[]>(
          githubKeys.trackedPullRequestList(repo),
          pullRequests,
        );

        setSelectedPr((current) => {
          if (!current || current.repo !== repo) return current;
          const refreshedSelection = pullRequests.find(
            (pullRequest) => pullRequest.number === current.number,
          );

          if (
            !refreshedSelection ||
            refreshedSelection.headSha === current.headSha
          ) {
            return current;
          }

          return {
            ...current,
            headSha: refreshedSelection.headSha,
          };
        });

        return pullRequests;
      } catch {
        return queryClient.getQueryData<PullRequestSummary[]>(
          githubKeys.trackedPullRequestList(repo),
        ) ?? [];
      }
    },
    [queryClient, setSelectedPr],
  );

  return {
    prsByRepo,
    repoErrors,
    refreshTrackedPullRequests,
  };
}

function useSelectedPullRequestData(selectedPr: SelectedPullRequest | null) {
  const selectedPatchQuery = useQuery({
    queryKey: selectedPr
      ? githubKeys.pullRequestPatch(selectedPr)
      : githubKeys.pullRequestPatchIdle(),
    queryFn: () => {
      if (!selectedPr) {
        throw new Error("No pull request selected");
      }

      return invoke<PrPatch>("get_pull_request_patch", {
        repo: selectedPr.repo,
        number: selectedPr.number,
        headSha: selectedPr.headSha,
      });
    },
    enabled: selectedPr !== null,
  });

  const changedFilesQuery = useQuery({
    queryKey: selectedPr
      ? githubKeys.pullRequestFiles(selectedPr)
      : githubKeys.pullRequestFilesIdle(),
    queryFn: () => {
      if (!selectedPr) {
        throw new Error("No pull request selected");
      }

      return invoke<string[]>("list_pull_request_changed_files", {
        repo: selectedPr.repo,
        number: selectedPr.number,
        headSha: selectedPr.headSha,
      });
    },
    enabled: selectedPr !== null,
  });

  const reviewThreadsQuery = useQuery({
    queryKey: selectedPr
      ? githubKeys.pullRequestReviewThreads(selectedPr)
      : githubKeys.pullRequestReviewThreadsIdle(),
    queryFn: () => {
      if (!selectedPr) {
        throw new Error("No pull request selected");
      }

      return invoke<ReviewThread[]>("get_pull_request_review_threads", {
        repo: selectedPr.repo,
        number: selectedPr.number,
      });
    },
    enabled: selectedPr !== null,
  });

  const selectedPatch = (selectedPatchQuery.data as PrPatch | undefined) ?? null;
  const changedFiles = (changedFilesQuery.data as string[] | undefined) ?? [];
  const reviewThreads =
    (reviewThreadsQuery.data as ReviewThread[] | undefined) ?? [];

  const isPatchLoading =
    selectedPr !== null &&
    (selectedPatchQuery.isPending ||
      (selectedPatchQuery.isFetching && !selectedPatchQuery.data));
  const isChangedFilesLoading =
    selectedPr !== null &&
    (changedFilesQuery.isPending ||
      (changedFilesQuery.isFetching && !changedFilesQuery.data));
  const isReviewThreadsLoading =
    selectedPr !== null &&
    (reviewThreadsQuery.isPending ||
      (reviewThreadsQuery.isFetching && !reviewThreadsQuery.data));

  return {
    changedFiles,
    changedFilesError: getErrorMessage(changedFilesQuery.error),
    isChangedFilesLoading,
    isPatchLoading,
    isReviewThreadsLoading,
    patchError: getErrorMessage(selectedPatchQuery.error),
    reviewThreads,
    reviewThreadsError: getErrorMessage(reviewThreadsQuery.error),
    selectedPatch,
  };
}

function usePullRequestReviewCommentMutations(
  selectedPr: SelectedPullRequest | null,
) {
  const queryClient = useQueryClient();
  const viewerLoginQuery = useQuery(viewerLoginQueryOptions());
  const viewerLogin = viewerLoginQuery.data?.login ?? "You";

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

      const rootComment = createOptimisticComment(input.body, viewerLogin, null);
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

  return {
    createCommentMutation,
    replyCommentMutation,
    updateCommentMutation,
    viewerLogin: viewerLoginQuery.data?.login ?? null,
  };
}

export {
  getErrorMessage,
  usePullRequestReviewCommentMutations,
  useRepoPickerRepos,
  useSavedRepos,
  useSelectedPullRequestData,
  useTrackedPullRequests,
};
