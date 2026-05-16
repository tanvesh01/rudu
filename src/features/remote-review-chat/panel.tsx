import { useChat } from "@ai-sdk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Conversation } from "../../components/ai-elements/chat";
import { getErrorMessage } from "../../hooks/useGithubQueries";
import type { UseRemoteReviewSessionResult } from "../../hooks/useRemoteReviewSession";
import { githubKeys, upsertTrackedPullRequest } from "../../queries/github";
import { getPullRequestSummary } from "../../queries/github-native";
import {
  type RemoteReviewChatMessageMetadata,
  type ReviewChatAttachment,
} from "./line-selection";
import type { PullRequestSummary } from "../../types/github";
import { listReviewWorkspaceFiles } from "../../queries/remote-review-native";
import { EmptyChatState } from "./empty-chat-state";
import { MessageList } from "./message-list";
import {
  REMOTE_REVIEW_CHAT_STARTER_PROMPTS,
  shouldShowRemoteReviewChatStarterPrompts,
} from "./onboarding";
import { useRemoteReviewChatOnboardingStore } from "./onboarding-store";
import { PromptComposer } from "./prompt-composer";
import { useRevisionRefreshGateStore } from "./revision-refresh-gate-store";
import {
  TauriAcpChatTransport,
  type RemoteReviewChatMessage,
} from "./transport";

const REVISION_REFRESH_POLL_INTERVAL_MS = 120_000;

type RemoteReviewChatPanelProps = {
  attachments: ReviewChatAttachment[];
  isActive: boolean;
  latestHeadSha: string | null;
  remoteReview: UseRemoteReviewSessionResult;
  onAddAttachment(attachment: ReviewChatAttachment): void;
  onClearAttachments(): void;
  onRemoveAttachment(attachmentId: string): void;
};

function RemoteReviewChatPanel({
  attachments,
  isActive,
  latestHeadSha,
  remoteReview,
  onAddAttachment,
  onClearAttachments,
  onRemoveAttachment,
}: RemoteReviewChatPanelProps) {
  const { session, workspaceActivity } = remoteReview.data;
  const { error, isLoadingSession } = remoteReview.status;
  const queryClient = useQueryClient();
  const hasSentFirstMessage = useRemoteReviewChatOnboardingStore(
    (state) => state.hasSentFirstMessage,
  );
  const markFirstMessageSent = useRemoteReviewChatOnboardingStore(
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
  const chat = useChat<RemoteReviewChatMessage>({
    id: session?.id ?? "remote-review-ai-chat-idle",
    transport: new TauriAcpChatTransport({ sessionId: session?.id ?? null }),
  });
  const selectedPrSummaryQuery = useQuery({
    queryKey: [
      "remote-review-chat",
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
      "remote-review-chat",
      "workspace-files",
      session?.id ?? "__idle__",
      session?.headSha ?? "__idle__",
    ] as const,
    queryFn: () => listReviewWorkspaceFiles(session?.id ?? "__idle__"),
    enabled: isActive && Boolean(session),
  });
  const observedLatestHeadSha =
    selectedPrSummaryQuery.data?.headSha ?? latestHeadSha;
  const isChatBusy = chat.status === "submitted" || chat.status === "streaming";
  const canSend = Boolean(session) && !isLoadingSession && !isChatBusy;
  const shouldShowStarterPrompts = shouldShowRemoteReviewChatStarterPrompts({
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

  function handleSend(text: string) {
    if (!canSend) return;
    if (!hasSentFirstMessage) {
      markFirstMessageSent();
    }
    const metadata: RemoteReviewChatMessageMetadata | undefined =
      attachments.length > 0 ? { attachments } : undefined;
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
        await remoteReview.actions.refreshRevisionContext(latestRefreshHeadSha);

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
        <div className="shrink-0 border-t border-ink-100 px-3 pt-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">
            Try one of these
          </p>
          <div className="flex flex-wrap gap-2">
            {REMOTE_REVIEW_CHAT_STARTER_PROMPTS.map((prompt) => (
              <button
                className="rounded-full border border-ink-200 bg-canvas px-3 py-1.5 text-xs text-ink-700 transition hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900"
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
        revisionRefreshGate={{
          error: revisionRefreshGateError,
          mode: revisionRefreshGateMode,
          revision: revisionRefreshGateRevision,
        }}
        sessionId={session?.id ?? null}
        sessionHeadSha={session?.headSha ?? null}
        workspaceFiles={workspaceFilesQuery.data ?? []}
        isLoadingWorkspaceFiles={workspaceFilesQuery.isFetching}
        onAddAttachment={onAddAttachment}
        onRemoveAttachment={onRemoveAttachment}
        onRefreshRevision={() => void handleRefreshRevision()}
        onSend={handleSend}
        onStop={() => void chat.stop()}
      />
    </Conversation>
  );
}

export { RemoteReviewChatPanel };
export type { RemoteReviewChatPanelProps };
