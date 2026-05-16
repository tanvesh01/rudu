import { QuestionMarkCircleIcon } from "@heroicons/react/20/solid";
import { useChat } from "@ai-sdk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Conversation } from "../../components/ai-elements/chat";
import { getErrorMessage } from "../../hooks/useGithubQueries";
import type { UseRemoteReviewSessionResult } from "../../hooks/useRemoteReviewSession";
import {
  githubKeys,
  upsertTrackedPullRequest,
} from "../../queries/github";
import { getPullRequestSummary } from "../../queries/github-native";
import {
  type RemoteReviewChatMessageMetadata,
  type RemoteReviewLineSelection,
} from "./line-selection";
import type { PullRequestSummary } from "../../types/github";
import { MessageList } from "./message-list";
import { RemoteReviewChatOnboardingDialog } from "./onboarding-dialog";
import {
  REMOTE_REVIEW_CHAT_STARTER_PROMPTS,
  shouldAutoOpenRemoteReviewChatIntro,
  shouldShowRemoteReviewChatStarterPrompts,
} from "./onboarding";
import { useRemoteReviewChatOnboardingStore } from "./onboarding-store";
import { PromptComposer } from "./prompt-composer";
import { useRevisionRefreshGateStore } from "./revision-refresh-gate-store";
import { TauriAcpChatTransport, type RemoteReviewChatMessage } from "./transport";

const REVISION_REFRESH_POLL_INTERVAL_MS = 120_000;

type RemoteReviewChatPanelProps = {
  isActive: boolean;
  latestHeadSha: string | null;
  remoteReview: UseRemoteReviewSessionResult;
  selectedLineContext: RemoteReviewLineSelection | null;
  onClearSelectedLineContext(): void;
};

type PiStatusTone = "green" | "yellow" | "red";

function getPiStatusView({
  chatStatus,
  error,
  isLoadingSession,
  session,
}: {
  chatStatus: string;
  error: string | null;
  isLoadingSession: boolean;
  session: UseRemoteReviewSessionResult["data"]["session"];
}): { label: string; tone: PiStatusTone } {
  if (error || session?.status === "failed") {
    return { label: "Pi unavailable", tone: "red" };
  }

  if (chatStatus === "submitted" || chatStatus === "streaming") {
    return { label: "Pi working", tone: "yellow" };
  }

  if (isLoadingSession || session?.status === "prepared") {
    return { label: "Pi preparing", tone: "yellow" };
  }

  if (session) {
    return { label: "Pi ready", tone: "green" };
  }

  return { label: "No PR selected", tone: "yellow" };
}

function PiStatusBadge({ tone }: { tone: PiStatusTone }) {
  const dotClass =
    tone === "green"
      ? "bg-emerald-500"
      : tone === "yellow"
        ? "bg-amber-400"
        : "bg-red-500";

  return (
    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-canvas">
      <span className={`size-2 rounded-full ${dotClass}`} />
    </span>
  );
}

function RemoteReviewChatPanel({
  isActive,
  latestHeadSha,
  remoteReview,
  selectedLineContext,
  onClearSelectedLineContext,
}: RemoteReviewChatPanelProps) {
  const { session } = remoteReview.data;
  const { error, isLoadingSession } = remoteReview.status;
  const queryClient = useQueryClient();
  const hasSeenIntro = useRemoteReviewChatOnboardingStore(
    (state) => state.hasSeenIntro,
  );
  const hasSentFirstMessage = useRemoteReviewChatOnboardingStore(
    (state) => state.hasSentFirstMessage,
  );
  const isIntroOpen = useRemoteReviewChatOnboardingStore(
    (state) => state.isIntroOpen,
  );
  const openIntro = useRemoteReviewChatOnboardingStore((state) => state.openIntro);
  const closeIntro = useRemoteReviewChatOnboardingStore(
    (state) => state.closeIntro,
  );
  const markIntroSeen = useRemoteReviewChatOnboardingStore(
    (state) => state.markIntroSeen,
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
    refetchInterval: isActive && Boolean(session)
      ? REVISION_REFRESH_POLL_INTERVAL_MS
      : false,
  });
  const observedLatestHeadSha =
    selectedPrSummaryQuery.data?.headSha ?? latestHeadSha;
  const isChatBusy = chat.status === "submitted" || chat.status === "streaming";
  const canSend =
    Boolean(session) &&
    !isLoadingSession &&
    !isChatBusy;
  const piStatus = getPiStatusView({
    chatStatus: chat.status,
    error: chat.error?.message ?? error,
    isLoadingSession,
    session,
  });
  const shouldShowStarterPrompts = shouldShowRemoteReviewChatStarterPrompts({
    hasSentFirstMessage,
    hasSession: Boolean(session),
  });

  useEffect(() => {
    if (
      shouldAutoOpenRemoteReviewChatIntro({
        hasSeenIntro,
        isActive,
        isIntroOpen,
      })
    ) {
      openIntro();
    }
  }, [hasSeenIntro, isActive, isIntroOpen, openIntro]);

  useEffect(() => {
    observeRevision({
      activeHeadSha: session?.headSha ?? null,
      latestHeadSha: observedLatestHeadSha,
      sessionId: session?.id ?? null,
    });
  }, [observeRevision, observedLatestHeadSha, session?.headSha, session?.id]);

  function dismissIntro() {
    markIntroSeen();
    closeIntro();
  }

  function handleSend(text: string) {
    if (!canSend) return;
    if (!hasSentFirstMessage) {
      markFirstMessageSent();
    }
    const metadata: RemoteReviewChatMessageMetadata | undefined =
      selectedLineContext
        ? { selectedLineContext }
        : undefined;
    void chat.sendMessage({
      text,
      metadata,
    });
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
      const session = await remoteReview.actions.refreshRevisionContext(
        latestRefreshHeadSha,
      );

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
      <RemoteReviewChatOnboardingDialog
        onContinue={dismissIntro}
        onOpenChange={(open) => {
          if (open) {
            openIntro();
            return;
          }
          dismissIntro();
        }}
        open={isIntroOpen}
      />

      <div className="shrink-0 border-b border-ink-100 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink-600">AI chat</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1 rounded-md border border-ink-200 px-2 py-1 text-[11px] font-medium text-ink-600 transition hover:bg-ink-50 hover:text-ink-900"
              onClick={() => openIntro()}
              type="button"
            >
              <QuestionMarkCircleIcon aria-hidden="true" className="size-3.5" />
              Help
            </button>
            <PiStatusBadge tone={piStatus.tone} />
          </div>
        </div>

        {error || chat.error ? (
          <p className="mt-2 text-xs leading-5 text-danger-600">
            {chat.error?.message ?? error}
          </p>
        ) : null}
      </div>

      <MessageList
        checkpoints={sessionRevisionCheckpoints}
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
        canSend={canSend}
        hasSession={Boolean(session)}
        isChatBusy={isChatBusy}
        revisionRefreshGate={{
          error: revisionRefreshGateError,
          mode: revisionRefreshGateMode,
          revision: revisionRefreshGateRevision,
        }}
        selectedLineContext={selectedLineContext}
        onClearSelectedLineContext={onClearSelectedLineContext}
        onRefreshRevision={() => void handleRefreshRevision()}
        onSend={handleSend}
        onStop={() => void chat.stop()}
      />
    </Conversation>
  );
}

export { RemoteReviewChatPanel };
export type { RemoteReviewChatPanelProps };
