import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { getErrorMessage } from "../../../hooks/useGithubQueries";
import type { UseReviewSessionResult } from "../../../hooks/useReviewSession";
import { githubKeys, upsertTrackedPullRequest } from "../../../queries/github";
import { getPullRequestSummary } from "../../../queries/github-native";
import type { PullRequestSummary, ReviewSession } from "../../../types/github";
import { useRevisionRefreshGateStore } from "./revision-refresh-gate-store";

const REVISION_REFRESH_POLL_INTERVAL_MS = 120_000;

type UseReviewChatRevisionRefreshOptions = {
  isActive: boolean;
  isChatBusy: boolean;
  latestHeadSha: string | null;
  messageCount: number;
  reviewSession: UseReviewSessionResult;
  session: ReviewSession | null;
  onRefetchTranscript(): void;
};

function useReviewChatRevisionRefresh({
  isActive,
  isChatBusy,
  latestHeadSha,
  messageCount,
  reviewSession,
  session,
  onRefetchTranscript,
}: UseReviewChatRevisionRefreshOptions) {
  const queryClient = useQueryClient();
  const revisionRefreshGateMode = useRevisionRefreshGateStore(
    (state) => state.mode,
  );
  const revisionRefreshGateRevision = useRevisionRefreshGateStore(
    (state) => state.revision,
  );
  const revisionRefreshGateError = useRevisionRefreshGateStore(
    (state) => state.error,
  );
  const observeRevision = useRevisionRefreshGateStore(
    (state) => state.observeRevision,
  );
  const startRevisionRefresh = useRevisionRefreshGateStore(
    (state) => state.startRefresh,
  );
  const finishRevisionRefresh = useRevisionRefreshGateStore(
    (state) => state.finishRefresh,
  );
  const failRevisionRefresh = useRevisionRefreshGateStore(
    (state) => state.failRefresh,
  );
  const selectedPrSummaryQuery = useQuery({
    queryKey: [
      "review-chat",
      "selected-pr-summary",
      session?.repo ?? "__idle__",
      session?.number ?? 0,
    ] as const,
    queryFn: () =>
      getPullRequestSummary({
        repo: session?.repo ?? "__idle__",
        number: session?.number ?? 0,
      }),
    enabled: isActive && Boolean(session),
    refetchInterval:
      isActive && Boolean(session) ? REVISION_REFRESH_POLL_INTERVAL_MS : false,
  });
  const observedLatestHeadSha =
    selectedPrSummaryQuery.data?.headSha ?? latestHeadSha;

  useEffect(() => {
    observeRevision({
      activeHeadSha: session?.headSha ?? null,
      latestHeadSha: observedLatestHeadSha,
      sessionId: session?.id ?? null,
    });
  }, [observeRevision, observedLatestHeadSha, session?.headSha, session?.id]);

  const handleRefreshRevision = useCallback(async () => {
    const latestRefreshHeadSha = revisionRefreshGateRevision?.latestHeadSha;
    if (!latestRefreshHeadSha) {
      return;
    }
    if (isChatBusy || !startRevisionRefresh()) {
      return;
    }

    try {
      const refreshedSession =
        await reviewSession.actions.refreshRevisionContext(
          latestRefreshHeadSha,
          messageCount,
        );

      finishRevisionRefresh({
        activeHeadSha: refreshedSession.headSha,
        sessionId: refreshedSession.id,
      });
      onRefetchTranscript();
      const refreshedSummary = selectedPrSummaryQuery.data;
      if (refreshedSummary?.headSha === refreshedSession.headSha) {
        queryClient.setQueryData<PullRequestSummary[]>(
          githubKeys.trackedPullRequestList(refreshedSession.repo),
          (current) => upsertTrackedPullRequest(current, refreshedSummary),
        );
      }
    } catch (error) {
      failRevisionRefresh(getErrorMessage(error));
    }
  }, [
    failRevisionRefresh,
    finishRevisionRefresh,
    isChatBusy,
    messageCount,
    onRefetchTranscript,
    queryClient,
    reviewSession.actions,
    revisionRefreshGateRevision?.latestHeadSha,
    selectedPrSummaryQuery.data,
    startRevisionRefresh,
  ]);

  return {
    handleRefreshRevision,
    revisionRefreshGate: {
      error: revisionRefreshGateError,
      mode: revisionRefreshGateMode,
      revision: revisionRefreshGateRevision,
    },
  };
}

export { useReviewChatRevisionRefresh };
