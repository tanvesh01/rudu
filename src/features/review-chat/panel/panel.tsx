import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { Progress } from "@base-ui/react/progress";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import {
  Conversation,
  ConversationScrollButton,
  type ConversationContext,
} from "../../../components/ai-elements/chat";
import type { UseReviewSessionResult } from "../../../hooks/useReviewSession";
import {
  issueDashboardQueryOptions,
  trackedPullRequestListQueryOptions,
} from "../../../queries/github";
import {
  listOpenCodeModels,
  listReviewWorkspaceFiles,
  setRuntimeModelChoice,
} from "../../../queries/review-session-native";
import { reviewSessionQueryOptions } from "../../../queries/review-session";
import type {
  FileStatsEntry,
  ReviewChatAdapterInstallEvent,
  ReviewChatReadinessStatus,
  ReviewChatRuntimeKind,
} from "../../../types/github";
import type { IssueDashboardData, IssueSummary } from "../../../types/issues";
import { EmptyChatState } from "../onboarding/empty-state";
import {
  type ReviewChatMessageMetadata,
  type ReviewChatAttachment,
  type ReviewChatInlineAttachmentRange,
} from "../selection/line-selection";
import type { ReviewChatDiffLineAttachmentRequest } from "../composer/editor";
import { MessageList } from "../transcript/message-list";
import { useReviewChatOnboardingStore } from "../onboarding/store";
import { PromptComposer } from "../composer/composer";
import { useReviewChatEffortMode } from "./use-effort-mode";
import { useReviewChatRevisionRefresh } from "./use-revision-refresh";
import { useReviewChatSession } from "./use-session";
import { useReviewChatWalkthroughCommand } from "./use-walkthrough-command";
import {
  useReviewChatMainThreadStallDebug,
  useReviewChatRenderDebug,
} from "../diagnostics/debug";
import {
  formatAdapterInstallProgress,
  getAdapterInstallProgressValue,
  isAdapterInstallRunning,
} from "./adapter-install-progress";

type ReviewChatPanelProps = {
  diffLineAttachmentRequest?: ReviewChatDiffLineAttachmentRequest | null;
  fileStatsByPath?: Map<string, FileStatsEntry> | null;
  isActive: boolean;
  latestHeadSha: string | null;
  reviewSession: UseReviewSessionResult;
  onDiffLineAttachmentRequestHandled(requestId: number): void;
  onDraftAttachmentsChange(attachments: ReviewChatAttachment[]): void;
  onReviewRuntimeChange(runtime: ReviewChatRuntimeKind): void;
  onNavigateToFile?(path: string): void;
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

function getReviewChatReadinessCopy(readiness: ReviewChatReadinessStatus | null) {
  if (!readiness) {
    return {
      title: "Checking Rudu setup",
      description:
        "Rudu is verifying Codex CLI and the Codex ACP connection before preparing the Review Workspace.",
      command: null,
    };
  }

  if (readiness.status === "missing_codex_cli") {
    return {
      title: "Codex CLI is required",
      description:
        readiness.message ??
        "Install Codex CLI from the OpenAI docs, sign in, then check again.",
      command: null,
    };
  }

  if (readiness.status === "codex_not_authenticated") {
    return {
      title: "Sign in to Codex CLI",
      description:
        "Rudu uses your local Codex CLI authentication for Review Chat.",
      command: "codex login",
    };
  }

  if (readiness.status === "missing_codex_acp") {
    return {
      title: "Codex ACP adapter is unavailable",
      description:
        readiness.message ??
        "Rudu could not install or start the managed Codex ACP adapter.",
      command: null,
    };
  }

  if (readiness.status === "missing_open_code_cli") {
    return {
      title: "OpenCode CLI is required",
      description:
        readiness.message ??
        "Install OpenCode CLI, authenticate it, then check again.",
      command: "opencode auth login",
    };
  }

  if (readiness.status === "acp_protocol_unsupported") {
    return {
      title: "Codex ACP protocol is unsupported",
      description:
        readiness.message ??
        "Update Rudu or the bundled Codex ACP adapter, then check again.",
      command: null,
    };
  }

  if (readiness.status === "acp_missing_required_capability") {
    return {
      title: "Codex ACP is missing a required capability",
      description:
        readiness.message ??
        "Rudu needs session loading support before Review Chat can start.",
      command: null,
    };
  }

  return {
    title: "Couldn't start Codex ACP",
    description:
      readiness.message ??
      "Rudu could not verify the local Codex ACP connection.",
    command: null,
  };
}

function ReviewChatReadinessSetup({
  adapterInstallEvent,
  error,
  isChecking,
  readiness,
  onCheckAgain,
}: {
  adapterInstallEvent: ReviewChatAdapterInstallEvent | null;
  error: string | null;
  isChecking: boolean;
  readiness: ReviewChatReadinessStatus | null;
  onCheckAgain: () => void;
}) {
  const copy = getReviewChatReadinessCopy(readiness);
  const hasInvokeError = Boolean(error && !readiness);
  const isInstallingAdapter = isAdapterInstallRunning(adapterInstallEvent);
  const installProgress = getAdapterInstallProgressValue(adapterInstallEvent);
  const installProgressLabel = adapterInstallEvent
    ? formatAdapterInstallProgress(adapterInstallEvent)
    : null;
  const title = hasInvokeError ? "Couldn't verify Rudu setup" : copy.title;
  const description = isInstallingAdapter
    ? (adapterInstallEvent?.message ?? "Installing Codex ACP adapter.")
    : isChecking
      ? "Checking Codex CLI and ACP before preparing Review Chat."
      : hasInvokeError
        ? error
      : copy.description;

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
      <div className="max-w-sm text-center">
        <div className="flex items-center justify-center gap-2 text-sm font-medium text-ink-900">
          {isChecking ? (
            <ArrowPathIcon className="size-4 animate-spin text-ink-500" />
          ) : null}
          {isChecking ? "Checking Rudu setup" : title}
        </div>
        <p className="mt-1 text-xs leading-5 text-ink-500">{description}</p>
        {copy.command && !isChecking ? (
          <div className="mx-auto mt-3 w-fit rounded-md border border-ink-200 bg-canvas px-2.5 py-1.5 font-mono text-xs text-ink-800">
            {copy.command}
          </div>
        ) : null}
        {isInstallingAdapter ? (
          <Progress.Root
            aria-valuetext={installProgressLabel ?? adapterInstallEvent?.message}
            className="mx-auto mt-4 w-56 text-left"
            value={installProgress}
          >
            <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-medium text-ink-500">
              <Progress.Label>Codex ACP</Progress.Label>
              {installProgressLabel ? (
                <Progress.Value>{() => installProgressLabel}</Progress.Value>
              ) : null}
            </div>
            <Progress.Track className="h-1.5 overflow-hidden rounded-full bg-ink-100">
              <Progress.Indicator
                className={
                  installProgress === null
                    ? "h-full w-1/3 animate-pulse rounded-full bg-ink-700"
                    : "h-full rounded-full bg-ink-700 transition-[width]"
                }
                style={
                  installProgress === null
                    ? undefined
                    : { width: `${installProgress}%` }
                }
              />
            </Progress.Track>
          </Progress.Root>
        ) : null}
        {!isChecking ? (
          <button
            className="mx-auto mt-3 inline-flex items-center gap-1.5 px-1 py-1 text-xs font-medium text-ink-600 transition hover:text-ink-900"
            onClick={onCheckAgain}
            type="button"
          >
            <ArrowPathIcon className="size-3.5" />
            Check again
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ReviewChatPanel({
  diffLineAttachmentRequest,
  fileStatsByPath,
  isActive,
  latestHeadSha,
  reviewSession,
  onDiffLineAttachmentRequestHandled,
  onDraftAttachmentsChange,
  onReviewRuntimeChange,
  onNavigateToFile,
}: ReviewChatPanelProps) {
  const { session } = reviewSession.data;
  const queryClient = useQueryClient();
  const { isCheckingReadiness, isLoadingSession } = reviewSession.status;
  const readiness = reviewSession.data.readiness;
  const isReviewChatReady = readiness?.status === "ready";
  const conversationContextRef = useRef<ConversationContext | null>(null);
  const chatBusyRef = useRef(false);
  const messageCountRef = useRef(0);
  const refetchTranscriptRef = useRef<() => void>(() => {});
  const hasSentFirstMessage = useReviewChatOnboardingStore(
    (state) => state.hasSentFirstMessage,
  );
  const markFirstMessageSent = useReviewChatOnboardingStore(
    (state) => state.markFirstMessageSent,
  );
  const refetchTranscript = useCallback(() => {
    refetchTranscriptRef.current();
  }, []);
  const reviewChatEffortMode = useReviewChatEffortMode({
    isChatBusyRef: chatBusyRef,
    messageCountRef,
    sessionId: session?.id ?? null,
    onRefetchTranscript: refetchTranscript,
  });
  const reviewChatSession = useReviewChatSession({
    conversationContextRef,
    isActive,
    isLoadingSession,
    isReviewChatReady,
    session,
    onRestorePendingReviewEffortMode:
      reviewChatEffortMode.restorePendingReviewEffortMode,
    onRestoreReviewEffortMode: reviewChatEffortMode.restoreReviewEffortMode,
    onSessionReset: reviewChatEffortMode.resetReviewEffortMode,
  });
  refetchTranscriptRef.current = () => {
    void reviewChatSession.transcriptQuery.refetch();
  };
  messageCountRef.current = reviewChatSession.chat.messages.length;

  const reviewWalkthroughCommand = useReviewChatWalkthroughCommand({
    canSend: reviewChatSession.canSend,
    chat: reviewChatSession.chat,
    conversationContextRef,
    hasSentFirstMessage,
    nextReviewEffortMode: reviewChatEffortMode.nextReviewEffortMode,
    sessionId: session?.id ?? null,
    onClearAttachments: () => {
      onDraftAttachmentsChange([]);
    },
    onCommitReviewEffortMode:
      reviewChatEffortMode.commitReviewEffortModeLocal,
    onMarkFirstMessageSent: markFirstMessageSent,
    onOptimisticThinkingChange:
      reviewChatSession.setIsOptimisticThinkingVisible,
  });
  const isChatBusy =
    reviewChatSession.isAcpChatBusy ||
    reviewWalkthroughCommand.isWalkthroughGenerating;
  const canSend =
    reviewChatSession.canSend &&
    !reviewWalkthroughCommand.isWalkthroughGenerating;
  chatBusyRef.current = isChatBusy;

  const reviewRevisionRefresh = useReviewChatRevisionRefresh({
    isActive,
    isChatBusy,
    latestHeadSha,
    messageCount: reviewChatSession.chat.messages.length,
    reviewSession,
    session,
    onRefetchTranscript: refetchTranscript,
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
  const opencodeModelsQuery = useQuery({
    queryKey: ["review-chat", "opencode-models"] as const,
    queryFn: listOpenCodeModels,
    enabled: isActive && session?.reviewRuntime === "open_code",
    retry: false,
  });
  const knownIssues = useMemo(
    () => flattenKnownIssues(knownIssuesQuery.data),
    [knownIssuesQuery.data],
  );
  useReviewChatRenderDebug("ReviewChatPanel", () => {
    const latestMessage =
      reviewChatSession.chat.messages[reviewChatSession.chat.messages.length - 1];
    return {
      isActive,
      isChatBusy,
      latestMessageParts: latestMessage?.parts.length ?? 0,
      latestMessageRole: latestMessage?.role ?? "none",
      messageCount: reviewChatSession.chat.messages.length,
      optimisticThinking: reviewChatSession.isOptimisticThinkingVisible,
      sessionId: session?.id ?? "none",
      status: reviewChatSession.chat.status,
    };
  });
  useReviewChatMainThreadStallDebug(isChatBusy, "ReviewChatPanel");

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
        ? {
            attachments: promptAttachments,
            inlineAttachments,
            reviewEffortMode: reviewChatEffortMode.nextReviewEffortMode,
          }
        : { reviewEffortMode: reviewChatEffortMode.nextReviewEffortMode };
    reviewChatSession.setIsOptimisticThinkingVisible(true);
    reviewChatEffortMode.commitReviewEffortMode(
      reviewChatEffortMode.nextReviewEffortMode,
    );
    void reviewChatSession.chat.sendMessage({
      text,
      metadata,
    });
    requestAnimationFrame(() => {
      void conversationContextRef.current?.scrollToBottom({
        animation: "smooth",
        ignoreEscapes: true,
      });
    });
    onDraftAttachmentsChange([]);
  }

  function updateSessionInCache(nextSession: NonNullable<typeof session>) {
    queryClient.setQueryData(
      reviewSessionQueryOptions({
        repo: nextSession.repo,
        number: nextSession.number,
      }).queryKey,
      nextSession,
    );
  }

  function handleRuntimeModelChange(model: string) {
    if (!session || session.reviewRuntime !== "open_code" || isChatBusy) return;
    if (!model || model === session.runtimeModelChoice) return;
    void setRuntimeModelChoice(session.id, model)
      .then(updateSessionInCache)
      .catch((error) => {
        console.error("Failed to switch runtime model", error);
      });
  }

  return (
    <Conversation
      className="review-chat-window"
      contextRef={conversationContextRef}
    >
      <div className="relative min-h-0 flex-1">
        {!isReviewChatReady ? (
          <ReviewChatReadinessSetup
            adapterInstallEvent={reviewSession.status.adapterInstallEvent}
            error={reviewSession.status.error}
            isChecking={isCheckingReadiness}
            readiness={readiness}
            onCheckAgain={() => void reviewSession.actions.checkReadiness()}
          />
        ) : (
          <>
            <div className="review-chat-top-fade pointer-events-none absolute inset-x-0 top-0 z-10 h-12" />
            <MessageList
              checkpoints={
                reviewChatSession.transcriptQuery.data?.revisionCheckpoints ?? []
              }
              emptyState={
                <EmptyChatState
                  canGenerateWalkthrough={canSend}
                  isGeneratingWalkthrough={
                    reviewWalkthroughCommand.isWalkthroughGenerating
                  }
                  onGenerateWalkthrough={() =>
                    void reviewWalkthroughCommand.handleGenerateWalkthrough()
                  }
                />
              }
              fileStatsByPath={fileStatsByPath}
              forcePendingThinking={
                reviewChatSession.isOptimisticThinkingVisible
              }
              isLoadingTranscript={reviewChatSession.isLoadingTranscript}
              messages={reviewChatSession.chat.messages}
              onSelectWalkthroughFile={onNavigateToFile}
              pendingThinkingTitle={
                reviewWalkthroughCommand.isWalkthroughGenerating
                  ? reviewWalkthroughCommand.walkthroughProgressMessage
                  : undefined
              }
              status={reviewChatSession.chat.status}
            />
            {reviewChatSession.chat.messages.length > 0 ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-1 z-10 flex justify-center -pb-1">
                <ConversationScrollButton className="pointer-events-auto" />
              </div>
            ) : null}
          </>
        )}
      </div>

      {isReviewChatReady ? (
        <PromptComposer
          canSend={canSend}
          currentRepo={session?.repo ?? null}
          diffLineAttachmentRequest={diffLineAttachmentRequest}
          hasSession={Boolean(session)}
          isChatBusy={reviewChatSession.isAcpChatBusy}
          knownIssues={knownIssues}
          knownPullRequests={knownPullRequestsQuery.data ?? []}
          pendingReviewEffortMode={
            reviewChatEffortMode.pendingReviewEffortMode
          }
          reviewRuntime={session?.reviewRuntime ?? "codex"}
          runtimeModelChoice={session?.runtimeModelChoice ?? null}
          runtimeModelOptions={
            session?.runtimeModelChoice &&
            !(opencodeModelsQuery.data ?? []).includes(session.runtimeModelChoice)
              ? [session.runtimeModelChoice, ...(opencodeModelsQuery.data ?? [])]
              : (opencodeModelsQuery.data ?? [])
          }
          isLoadingRuntimeModels={opencodeModelsQuery.isLoading}
          reviewEffortMode={reviewChatEffortMode.reviewEffortMode}
          revisionRefreshGate={reviewRevisionRefresh.revisionRefreshGate}
          sessionId={session?.id ?? null}
          sessionHeadSha={session?.headSha ?? null}
          workspaceFiles={workspaceFilesQuery.data ?? []}
          onDiffLineAttachmentRequestHandled={
            onDiffLineAttachmentRequestHandled
          }
          onDraftAttachmentsChange={onDraftAttachmentsChange}
          onRefreshRevision={() =>
            void reviewRevisionRefresh.handleRefreshRevision()
          }
          onReviewEffortModeChange={
            reviewChatEffortMode.handleReviewEffortModeChange
          }
          onReviewRuntimeChange={onReviewRuntimeChange}
          onRuntimeModelChange={handleRuntimeModelChange}
          onSend={handleSend}
          onStop={() => void reviewChatSession.chat.stop()}
        />
      ) : null}
    </Conversation>
  );
}

export { ReviewChatPanel };
export type { ReviewChatPanelProps };
