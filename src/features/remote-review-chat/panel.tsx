import { QuestionMarkCircleIcon } from "@heroicons/react/20/solid";
import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Conversation } from "../../components/ai-elements/chat";
import type { UseRemoteReviewSessionResult } from "../../hooks/useRemoteReviewSession";
import { remoteReviewKeys } from "../../queries/remote-review";
import {
  type RemoteReviewChatMessageMetadata,
  type RemoteReviewLineSelection,
} from "./line-selection";
import { MessageList } from "./message-list";
import { RemoteReviewChatOnboardingDialog } from "./onboarding-dialog";
import {
  REMOTE_REVIEW_CHAT_STARTER_PROMPTS,
  shouldAutoOpenRemoteReviewChatIntro,
  shouldShowRemoteReviewChatStarterPrompts,
} from "./onboarding";
import { useRemoteReviewChatOnboardingStore } from "./onboarding-store";
import { PromptComposer } from "./prompt-composer";
import { TauriAcpChatTransport, type RemoteReviewChatMessage } from "./transport";
import { WorkerSetupCard } from "./worker-setup-card";

type RemoteReviewChatPanelProps = {
  isActive: boolean;
  remoteReview: UseRemoteReviewSessionResult;
  selectedLineContext: RemoteReviewLineSelection | null;
  onClearSelectedLineContext(): void;
};

type PiStatusTone = "green" | "yellow" | "red";

function getPiStatusView({
  chatStatus,
  error,
  isLoadingSession,
  isLoadingWorkerConfig,
  session,
  workerConfigured,
}: {
  chatStatus: string;
  error: string | null;
  isLoadingSession: boolean;
  isLoadingWorkerConfig: boolean;
  session: UseRemoteReviewSessionResult["data"]["session"];
  workerConfigured: boolean;
}): { label: string; tone: PiStatusTone } {
  if (error || session?.status === "failed" || !workerConfigured) {
    return { label: "Pi unavailable", tone: "red" };
  }

  if (chatStatus === "submitted" || chatStatus === "streaming") {
    return { label: "Pi working", tone: "yellow" };
  }

  if (
    isLoadingSession ||
    isLoadingWorkerConfig ||
    session?.status === "prepared"
  ) {
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
  remoteReview,
  selectedLineContext,
  onClearSelectedLineContext,
}: RemoteReviewChatPanelProps) {
  const { session, workerConfig } = remoteReview.data;
  const { error, isLoadingSession, isLoadingWorkerConfig } =
    remoteReview.status;
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
  const chat = useChat<RemoteReviewChatMessage>({
    id: session?.id ?? "remote-review-ai-chat-idle",
    onError: () => {
      void queryClient.invalidateQueries({
        queryKey: remoteReviewKeys.sessions(),
      });
    },
    onFinish: () => {
      void queryClient.invalidateQueries({
        queryKey: remoteReviewKeys.sessions(),
      });
    },
    transport: new TauriAcpChatTransport({ sessionId: session?.id ?? null }),
  });
  const isChatBusy = chat.status === "submitted" || chat.status === "streaming";
  const canSend =
    Boolean(session) &&
    workerConfig?.configured === true &&
    !isLoadingSession &&
    !isLoadingWorkerConfig &&
    !isChatBusy;
  const workerConfigured = workerConfig?.configured === true;
  const piStatus = getPiStatusView({
    chatStatus: chat.status,
    error: chat.error?.message ?? error,
    isLoadingSession,
    isLoadingWorkerConfig,
    session,
    workerConfigured,
  });
  const shouldShowStarterPrompts = shouldShowRemoteReviewChatStarterPrompts({
    hasSentFirstMessage,
    workerConfigured,
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
        workerConfigured={workerConfigured}
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

        {!workerConfigured || isLoadingWorkerConfig ? (
          <div className="mt-3">
            {isLoadingWorkerConfig ? (
              <p className="rounded-lg border border-ink-100 bg-canvas p-2 text-xs text-ink-500">
                Loading Worker config...
              </p>
            ) : (
              <WorkerSetupCard remoteReview={remoteReview} />
            )}
          </div>
        ) : null}

        {error || chat.error ? (
          <p className="mt-2 text-xs leading-5 text-danger-600">
            {chat.error?.message ?? error}
          </p>
        ) : null}
      </div>

      <MessageList messages={chat.messages} status={chat.status} />

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
        selectedLineContext={selectedLineContext}
        onClearSelectedLineContext={onClearSelectedLineContext}
        onSend={handleSend}
        onStop={() => void chat.stop()}
      />
    </Conversation>
  );
}

export { RemoteReviewChatPanel };
export type { RemoteReviewChatPanelProps };
