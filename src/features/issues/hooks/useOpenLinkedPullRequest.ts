import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  githubKeys,
  savedReposQueryOptions,
  trackedPullRequestListQueryOptions,
  upsertTrackedPullRequest,
} from "@/queries/github";
import {
  getPullRequestSummary,
  saveRepo,
  trackPullRequest,
  validateRepo,
} from "@/queries/github-native";
import {
  getPullRequestRouteParams,
  PULL_REQUEST_ROUTE,
} from "@/lib/pull-request-route";
import { appToastManager } from "@/lib/toasts";
import type {
  IssueLinkedPullRequest,
  PullRequestSummary,
  RepoSummary,
} from "@/types/github";

const OPEN_LINKED_PR_TOAST_ID = "open-linked-pull-request";
const OPEN_LINKED_PR_ERROR_TOAST_ID = "open-linked-pull-request-error";
const MIN_LOADING_TOAST_MS = 250;

type QueryClientLike = {
  fetchQuery(
    options: ReturnType<typeof trackedPullRequestListQueryOptions>,
  ): Promise<PullRequestSummary[]>;
  setQueryData<T>(
    queryKey: readonly unknown[],
    updater: (current: T | undefined) => T,
  ): void;
};

type ToastManagerLike = {
  add(toast: {
    id: string;
    title: string;
    description?: string;
    timeout?: number;
    data?: {
      placement?: "center";
      variant?: "patch-loading";
      hideClose?: boolean;
    };
  }): void;
  close(id: string): void;
};

type NavigateToPullRequest = (options: {
  params: NonNullable<ReturnType<typeof getPullRequestRouteParams>>;
  to: typeof PULL_REQUEST_ROUTE;
}) => Promise<unknown> | unknown;

type OpenLinkedPullRequestDeps = {
  delayFn?: (ms: number) => Promise<unknown>;
  getPullRequestSummaryFn?: typeof getPullRequestSummary;
  navigate: NavigateToPullRequest;
  now?: () => number;
  queryClient: QueryClientLike;
  saveRepoFn?: typeof saveRepo;
  toastManager?: ToastManagerLike;
  trackPullRequestFn?: typeof trackPullRequest;
  validateRepoFn?: typeof validateRepo;
};

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function showOpeningToast(
  pullRequest: IssueLinkedPullRequest,
  toastManager: ToastManagerLike,
) {
  toastManager.close(OPEN_LINKED_PR_TOAST_ID);
  toastManager.add({
    id: OPEN_LINKED_PR_TOAST_ID,
    title: `Opening PR #${pullRequest.number}...`,
    timeout: 0,
    data: {
      placement: "center",
      variant: "patch-loading",
      hideClose: true,
    },
  });
}

function showOpenError(error: unknown, toastManager: ToastManagerLike) {
  toastManager.close(OPEN_LINKED_PR_ERROR_TOAST_ID);
  toastManager.add({
    id: OPEN_LINKED_PR_ERROR_TOAST_ID,
    title: "Could not open linked PR",
    description: error instanceof Error ? error.message : String(error),
  });
}

function upsertSavedRepo(
  current: RepoSummary[] | undefined,
  savedRepo: RepoSummary,
) {
  if (!current) return [savedRepo];
  if (current.some((repo) => repo.nameWithOwner === savedRepo.nameWithOwner)) {
    return current;
  }

  return [...current, savedRepo];
}

function createOpenLinkedPullRequestHandler({
  delayFn = delay,
  getPullRequestSummaryFn = getPullRequestSummary,
  navigate,
  now = Date.now,
  queryClient,
  saveRepoFn = saveRepo,
  toastManager = appToastManager,
  trackPullRequestFn = trackPullRequest,
  validateRepoFn = validateRepo,
}: OpenLinkedPullRequestDeps) {
  return async function openLinkedPullRequest(
    pullRequest: IssueLinkedPullRequest,
  ) {
    const params = getPullRequestRouteParams(
      pullRequest.repo,
      pullRequest.number,
    );
    if (!params) {
      showOpenError(
        `Cannot open ${pullRequest.repo}#${pullRequest.number}.`,
        toastManager,
      );
      return;
    }

    const startedAt = now();
    showOpeningToast(pullRequest, toastManager);

    try {
      const trackedPullRequests = await queryClient.fetchQuery(
        trackedPullRequestListQueryOptions(pullRequest.repo),
      );
      const alreadyTracked = trackedPullRequests.some(
        (trackedPullRequest) => trackedPullRequest.number === pullRequest.number,
      );

      if (!alreadyTracked) {
        const validatedRepo = await validateRepoFn(pullRequest.repo);
        const savedRepo = await saveRepoFn(validatedRepo);
        queryClient.setQueryData<RepoSummary[]>(
          savedReposQueryOptions().queryKey,
          (current) => upsertSavedRepo(current, savedRepo),
        );

        const summary = await getPullRequestSummaryFn({
          repo: savedRepo.nameWithOwner,
          number: pullRequest.number,
        });
        const trackedPullRequest = await trackPullRequestFn(
          savedRepo.nameWithOwner,
          summary,
        );
        queryClient.setQueryData<PullRequestSummary[]>(
          githubKeys.trackedPullRequestList(savedRepo.nameWithOwner),
          (current) => upsertTrackedPullRequest(current, trackedPullRequest),
        );
      }

      await navigate({
        params,
        to: PULL_REQUEST_ROUTE,
      });

      const elapsed = now() - startedAt;
      if (elapsed < MIN_LOADING_TOAST_MS) {
        await delayFn(MIN_LOADING_TOAST_MS - elapsed);
      }
    } catch (error) {
      showOpenError(error, toastManager);
    } finally {
      toastManager.close(OPEN_LINKED_PR_TOAST_ID);
    }
  };
}

function useOpenLinkedPullRequest() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return createOpenLinkedPullRequestHandler({
    navigate,
    queryClient,
  });
}

export { createOpenLinkedPullRequestHandler, useOpenLinkedPullRequest };
export type { OpenLinkedPullRequestDeps };
