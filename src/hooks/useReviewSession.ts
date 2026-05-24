import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { getErrorMessage } from "./useGithubQueries";
import {
  prepareReviewWorkspaceQueryOptions,
  reviewChatReadinessQueryOptions,
  reviewSessionQueryOptions,
} from "../queries/review-session";
import { refreshReviewSession } from "../queries/review-session-native";
import type {
  ReviewSession,
  ReviewChatAdapterInstallEvent,
  SelectedPullRequestRevision,
} from "../types/github";

const IDLE_PULL_REQUEST_REVISION: SelectedPullRequestRevision = {
  repo: "__idle__",
  number: 0,
  headSha: "__idle__",
};

type UseReviewSessionOptions = {
  enabled?: boolean;
};

function useReviewSession(
  selectedRevision: SelectedPullRequestRevision | null,
  options: UseReviewSessionOptions = {},
) {
  const isEnabled = options.enabled ?? true;
  const queryClient = useQueryClient();
  const [adapterInstallEvent, setAdapterInstallEvent] =
    useState<ReviewChatAdapterInstallEvent | null>(null);
  const handleAdapterInstallEvent = useCallback(
    (event: ReviewChatAdapterInstallEvent) => {
      setAdapterInstallEvent(event);
    },
    [],
  );
  const reviewChatReadinessQuery = useQuery({
    ...reviewChatReadinessQueryOptions(handleAdapterInstallEvent),
    enabled: isEnabled,
  });
  const isReviewChatReady =
    reviewChatReadinessQuery.data?.status === "ready";
  const sessionRecordQuery = useQuery({
    ...reviewSessionQueryOptions(selectedRevision ?? IDLE_PULL_REQUEST_REVISION),
    enabled: isEnabled && selectedRevision !== null,
  });
  const prepareWorkspaceQuery = useQuery({
    ...prepareReviewWorkspaceQueryOptions(
      selectedRevision ?? IDLE_PULL_REQUEST_REVISION,
    ),
    enabled:
      isEnabled &&
      selectedRevision !== null &&
      isReviewChatReady &&
      sessionRecordQuery.isSuccess &&
      !sessionRecordQuery.data,
  });
  const session =
    (sessionRecordQuery.data as ReviewSession | null | undefined) ??
    (prepareWorkspaceQuery.data as ReviewSession | undefined) ??
    null;

  useEffect(() => {
    if (!selectedRevision || !prepareWorkspaceQuery.data) {
      return;
    }

    queryClient.setQueryData(
      reviewSessionQueryOptions({
        repo: selectedRevision.repo,
        number: selectedRevision.number,
      }).queryKey,
      prepareWorkspaceQuery.data,
    );
  }, [
    prepareWorkspaceQuery.data,
    queryClient,
    selectedRevision?.number,
    selectedRevision?.repo,
  ]);

  return {
    data: {
      readiness: reviewChatReadinessQuery.data ?? null,
      session,
    },
    status: {
      error: getErrorMessage(
        reviewChatReadinessQuery.error ??
          sessionRecordQuery.error ??
          prepareWorkspaceQuery.error,
      ),
      isCheckingReadiness: isEnabled && reviewChatReadinessQuery.isFetching,
      adapterInstallEvent:
        isEnabled && reviewChatReadinessQuery.isFetching
          ? adapterInstallEvent
          : null,
      isLoadingSession:
        isEnabled &&
        selectedRevision !== null &&
        (reviewChatReadinessQuery.isPending ||
          sessionRecordQuery.isPending ||
          (prepareWorkspaceQuery.isFetching && !prepareWorkspaceQuery.data)),
    },
    actions: {
      checkReadiness: () => {
        setAdapterInstallEvent(null);
        return reviewChatReadinessQuery.refetch();
      },
      refreshRevisionContext: async (headSha: string, messageCount: number) => {
        if (!session) {
          throw new Error(
            "Prepare the review session before refreshing the PR.",
          );
        }

        const refreshedSession = await refreshReviewSession(
          session.id,
          headSha,
          messageCount,
        );
        if (selectedRevision) {
          queryClient.setQueryData(
            reviewSessionQueryOptions(selectedRevision).queryKey,
            refreshedSession,
          );
        }
        queryClient.setQueryData(
          reviewSessionQueryOptions(refreshedSession).queryKey,
          refreshedSession,
        );
        return refreshedSession;
      },
    },
  };
}

export { useReviewSession };
export type UseReviewSessionResult = ReturnType<
  typeof useReviewSession
>;
