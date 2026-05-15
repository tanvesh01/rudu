import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getErrorMessage } from "./useGithubQueries";
import { shouldHydrateRemoteReviewSession } from "../lib/remote-review";
import {
  remoteReviewReportQueryOptions,
  remoteReviewSessionQueryOptions,
} from "../queries/remote-review";
import {
  hydrateRemoteReviewSession,
  launchPiReviewTerminal,
} from "../queries/remote-review-native";
import type {
  RemoteReviewReport,
  RemoteReviewSession,
  SelectedPullRequestRevision,
} from "../types/github";

const IDLE_PULL_REQUEST_REVISION: SelectedPullRequestRevision = {
  repo: "__idle__",
  number: 0,
  headSha: "__idle__",
};

function useRemoteReviewSession(
  selectedRevision: SelectedPullRequestRevision | null,
) {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    ...remoteReviewSessionQueryOptions(
      selectedRevision ?? IDLE_PULL_REQUEST_REVISION,
    ),
    enabled: selectedRevision !== null,
  });
  const session = (sessionQuery.data as RemoteReviewSession | undefined) ?? null;

  const reportQuery = useQuery({
    ...remoteReviewReportQueryOptions(session?.id ?? "__idle__"),
    enabled: session !== null,
    refetchInterval: session?.status === "launched" ? 5000 : false,
  });
  const report = (reportQuery.data as RemoteReviewReport | null | undefined) ?? null;

  const hydrateMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      await hydrateRemoteReviewSession(sessionId);
    },
    onSuccess: async () => {
      if (!selectedRevision) return;
      await queryClient.invalidateQueries({
        exact: true,
        queryKey: remoteReviewSessionQueryOptions(selectedRevision).queryKey,
      });
    },
  });

  const launchMutation = useMutation({
    mutationFn: launchPiReviewTerminal,
    onSuccess: async () => {
      if (!selectedRevision) return;
      await queryClient.invalidateQueries({
        exact: true,
        queryKey: remoteReviewSessionQueryOptions(selectedRevision).queryKey,
      });
      if (session) {
        await queryClient.invalidateQueries({
          exact: true,
          queryKey: remoteReviewReportQueryOptions(session.id).queryKey,
        });
      }
    },
  });

  const refreshReport = useCallback(() => {
    if (!session) {
      return Promise.resolve();
    }
    return queryClient.invalidateQueries({
      exact: true,
      queryKey: remoteReviewReportQueryOptions(session.id).queryKey,
    });
  }, [queryClient, session]);

  const runReview = useCallback(async () => {
    if (!session) {
      return;
    }

    if (shouldHydrateRemoteReviewSession(session)) {
      await hydrateMutation.mutateAsync(session.id);
    }

    await launchMutation.mutateAsync(session.id);
  }, [hydrateMutation, launchMutation, session]);

  return {
    data: {
      report,
      session,
    },
    status: {
      error:
        getErrorMessage(sessionQuery.error) ||
        getErrorMessage(reportQuery.error) ||
        getErrorMessage(hydrateMutation.error) ||
        getErrorMessage(launchMutation.error),
      isHydrating: hydrateMutation.isPending,
      isLaunching: launchMutation.isPending,
      isLoadingSession:
        selectedRevision !== null &&
        (sessionQuery.isPending ||
          (sessionQuery.isFetching && !sessionQuery.data)),
      isRefreshingReport: reportQuery.isFetching,
      isRunning: hydrateMutation.isPending || launchMutation.isPending,
    },
    actions: {
      refreshReport,
      runReview,
    },
  };
}

export { useRemoteReviewSession };
export type UseRemoteReviewSessionResult = ReturnType<typeof useRemoteReviewSession>;
