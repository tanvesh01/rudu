import { useChat } from "@ai-sdk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Conversation } from "../../components/ai-elements/chat";
import { getErrorMessage } from "../../hooks/useGithubQueries";
import type { UseReviewSessionResult } from "../../hooks/useReviewSession";
import {
  githubKeys,
  issueDashboardQueryOptions,
  trackedPullRequestListQueryOptions,
  upsertTrackedPullRequest,
} from "../../queries/github";
import { getPullRequestSummary } from "../../queries/github-native";
import {
  type ReviewChatMessageMetadata,
  type ReviewChatAttachment,
  type ReviewChatInlineAttachmentRange,
} from "./line-selection";
import type { PullRequestSummary } from "../../types/github";
import type { IssueDashboardData, IssueSummary } from "../../types/issues";
import { listReviewWorkspaceFiles } from "../../queries/review-session-native";
import { EmptyChatState } from "./empty-chat-state";
import { MessageList } from "./message-list";
import {
  REVIEW_CHAT_STARTER_PROMPTS,
  shouldShowReviewChatStarterPrompts,
} from "./onboarding";
import { useReviewChatOnboardingStore } from "./onboarding-store";
import { PromptComposer } from "./prompt-composer";
import { useRevisionRefreshGateStore } from "./revision-refresh-gate-store";
import {
  TauriAcpChatTransport,
  type ReviewChatMessage,
} from "./transport";

const REVISION_REFRESH_POLL_INTERVAL_MS = 120_000;

type ReviewChatPanelProps = {
  attachments: ReviewChatAttachment[];
  isActive: boolean;
  latestHeadSha: string | null;
  reviewSession: UseReviewSessionResult;
  onClearAttachments(): void;
  onRemoveAttachment(attachmentId: string): void;
};

function flattenKnownIssues(
  issueDashboard: IssueDashboardData | undefined,
): IssueSummary[] {
  if (!issueDashboard) return [];

  const seen = new Set<string>();
  const issues: IssueSummary[] = [];
  const buckets = issueDashboard.buckets;

  for (const issue of [
    ...buckets.inProgress,
    ...buckets.assigned,
    ...buckets.subscribed,
    ...buckets.created,
  ]) {
    const key = `${issue.provider}:${issue.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
  }

  return issues;
}

function ReviewChatPanel({
  attachments,
  isActive,
  latestHeadSha,
  reviewSession,
  onClearAttachments,
  onRemoveAttachment,
}: ReviewChatPanelProps) {
  const { session, workspaceActivity } = reviewSession.data;
  const { error, isLoadingSession } = reviewSession.status;
  const queryClient = useQueryClient();
  const hasSentFirstMessage = useReviewChatOnboardingStore(
    (state) => state.hasSentFirstMessage,
  );
  const markFirstMessageSent = useReviewChatOnboardingStore(
    (state) => state.markFirstMessageSent,
  );
  const revisionRefreshGateMode = useRevisionRefreshGateStore(
    (state) => state.mode,
  );
  const revisionRefreshGateRevision = useRevisionRefreshGateStore(
    (state) => state.revision,
  );
  const revisionRefreshGateError = useRevisionRefreshGateStore(
    (state) => state.error,
  );
  const revisionCheckpoints = useRevisionRefreshGateStore(
    (state) => state.checkpoints,
  );
  const sessionRevisionCheckpoints = useMemo(
    () =>
      revisionCheckpoints.filter(
        (checkpoint) => checkpoint.sessionId === session?.id,
      ),
    [revisionCheckpoints, session?.id],
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
  const chat = useChat<ReviewChatMessage>({
    id: session?.id ?? "review-chat-idle",
    transport: new TauriAcpChatTransport({ sessionId: session?.id ?? null }),
  });
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
  const workspaceFilesQuery = useQuery({
    queryKey: [
      "review-chat",
      "workspace-files",
      session?.id ?? "__idle__",
      session?.headSha ?? "__idle__",
    ] as const,
    queryFn: () => listReviewWorkspaceFiles(session?.id ?? "__idle__"),
    enabled: isActive && Boolean(session),
  });
  const knownIssuesQuery = useQuery({
    ...issueDashboardQueryOptions(),
    enabled: isActive,
  });
  const knownPullRequestsQuery = useQuery({
    ...trackedPullRequestListQueryOptions(session?.repo ?? "__idle__"),
    enabled: isActive && Boolean(session?.repo),
  });
  const observedLatestHeadSha =
    selectedPrSummaryQuery.data?.headSha ?? latestHeadSha;
  const knownIssues = useMemo(
    () => flattenKnownIssues(knownIssuesQuery.data),
    [knownIssuesQuery.data],
  );
  const isChatBusy = chat.status === "submitted" || chat.status === "streaming";
  const canSend = Boolean(session) && !isLoadingSession && !isChatBusy;
  const shouldShowStarterPrompts = shouldShowReviewChatStarterPrompts({
    hasSentFirstMessage,
    hasSession: Boolean(session),
  });

  useEffect(() => {
    observeRevision({
      activeHeadSha: session?.headSha ?? null,
      latestHeadSha: observedLatestHeadSha,
      sessionId: session?.id ?? null,
    });
  }, [observeRevision, observedLatestHeadSha, session?.headSha, session?.id]);

  function handleSend(
    text: string,
    promptAttachments: ReviewChatAttachment[] = [],
    inlineAttachments: ReviewChatInlineAttachmentRange[] = [],
  ) {
    if (!canSend) return;
    if (!hasSentFirstMessage) {
      markFirstMessageSent();
    }
    const metadata: ReviewChatMessageMetadata | undefined =
      promptAttachments.length > 0 || inlineAttachments.length > 0
        ? { attachments: promptAttachments, inlineAttachments }
        : undefined;
    void chat.sendMessage({
      text,
      metadata,
    });
    onClearAttachments();
  }

  async function handleRefreshRevision() {
    const latestRefreshHeadSha = revisionRefreshGateRevision?.latestHeadSha;
    if (!latestRefreshHeadSha) {
      return;
    }
    if (isChatBusy || !startRevisionRefresh()) {
      return;
    }

    try {
      const session =
        await reviewSession.actions.refreshRevisionContext(latestRefreshHeadSha);

      finishRevisionRefresh({
        activeHeadSha: session.headSha,
        messageCount: chat.messages.length,
        sessionId: session.id,
      });
      const refreshedSummary = selectedPrSummaryQuery.data;
      if (refreshedSummary?.headSha === session.headSha) {
        queryClient.setQueryData<PullRequestSummary[]>(
          githubKeys.trackedPullRequestList(session.repo),
          (current) => upsertTrackedPullRequest(current, refreshedSummary),
        );
      }
    } catch (error) {
      failRevisionRefresh(getErrorMessage(error));
    }
  }

  return (
    <Conversation>
      <MessageList
        checkpoints={sessionRevisionCheckpoints}
        emptyState={
          <EmptyChatState
            activityEntries={workspaceActivity}
            activityError={chat.error?.message ?? error}
            isPreparingWorkspace={isLoadingSession}
          />
        }
        messages={chat.messages}
        status={chat.status}
      />

      {shouldShowStarterPrompts && canSend ? (
        <div className="shrink-0 border-t border-ink-100 px-[1.15rem] pt-3">
          <p className="mb-2 text-sm font-medium uppercase tracking-[0.08em] text-ink-500">
            Try one of these
          </p>
          <div className="flex flex-wrap gap-2">
            {REVIEW_CHAT_STARTER_PROMPTS.map((prompt) => (
              <button
                className="rounded-full border border-ink-200 bg-canvas px-3 py-1.5 text-sm text-ink-700 transition hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900"
                key={prompt}
                onClick={() => handleSend(prompt)}
                type="button"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <PromptComposer
        attachments={attachments}
        canSend={canSend}
        currentRepo={session?.repo ?? null}
        hasSession={Boolean(session)}
        isChatBusy={isChatBusy}
        knownIssues={knownIssues}
        knownPullRequests={knownPullRequestsQuery.data ?? []}
        revisionRefreshGate={{
          error: revisionRefreshGateError,
          mode: revisionRefreshGateMode,
          revision: revisionRefreshGateRevision,
        }}
        sessionId={session?.id ?? null}
        sessionHeadSha={session?.headSha ?? null}
        workspaceFiles={workspaceFilesQuery.data ?? []}
        onRemoveAttachment={onRemoveAttachment}
        onRefreshRevision={() => void handleRefreshRevision()}
        onSend={handleSend}
        onStop={() => void chat.stop()}
      />
    </Conversation>
  );
}

export { ReviewChatPanel };
export type { ReviewChatPanelProps };
