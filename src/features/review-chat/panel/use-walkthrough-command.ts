import { useCallback, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ConversationContext } from "../../../components/ai-elements/chat";
import { runReviewWalkthroughTurn } from "../../../queries/review-session-native";
import type {
  ReviewChatActiveTurn,
  ReviewChatTranscript,
} from "../../../types/github";
import type { ReviewChatEffortMode } from "../composer/mode-toggle";
import type { ReviewChatMessage } from "../runtime/transport";
import {
  clearWalkthroughCommandState,
  DEFAULT_WALKTHROUGH_PROGRESS_MESSAGE,
  setWalkthroughCommandState,
  useWalkthroughCommandState,
} from "./walkthrough-command-state";
import { reviewChatTranscriptQueryKey } from "./transcript-cache";

type ReviewChatMessageController = {
  messages: ReviewChatMessage[];
  setMessages(messages: ReviewChatMessage[]): void;
};

type UseReviewChatWalkthroughCommandOptions = {
  activeTurn: ReviewChatActiveTurn | null;
  canSend: boolean;
  chat: ReviewChatMessageController;
  conversationContextRef: RefObject<ConversationContext | null>;
  hasSentFirstMessage: boolean;
  nextReviewEffortMode: ReviewChatEffortMode;
  sessionId: string | null;
  onClearAttachments(): void;
  onCommitReviewEffortMode(mode: ReviewChatEffortMode): void;
  onMarkFirstMessageSent(): void;
  onOptimisticThinkingChange(isVisible: boolean): void;
};

function createLocalTurnId(prefix: string) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

  return `${prefix}-${suffix}`;
}

function useReviewChatWalkthroughCommand({
  activeTurn,
  canSend,
  chat,
  conversationContextRef,
  hasSentFirstMessage,
  nextReviewEffortMode,
  sessionId,
  onClearAttachments,
  onCommitReviewEffortMode,
  onMarkFirstMessageSent,
  onOptimisticThinkingChange,
}: UseReviewChatWalkthroughCommandOptions) {
  const queryClient = useQueryClient();
  const walkthroughState = useWalkthroughCommandState(sessionId);
  const isWalkthroughTurnActive =
    activeTurn?.kind === "walkthrough" && activeTurn.status === "running";
  const isWalkthroughGenerating =
    walkthroughState?.isGenerating === true || isWalkthroughTurnActive;
  const walkthroughProgressMessage =
    walkthroughState?.progressMessage ??
    (activeTurn?.kind === "walkthrough" ? activeTurn.progressMessage : null) ??
    DEFAULT_WALKTHROUGH_PROGRESS_MESSAGE;

  const resetWalkthroughCommand = useCallback(() => {
    if (sessionId) {
      clearWalkthroughCommandState(sessionId);
    }
  }, [sessionId]);

  const handleGenerateWalkthrough = useCallback(async () => {
    if (!canSend || !sessionId || chat.messages.length > 0) {
      return;
    }

    if (!hasSentFirstMessage) {
      onMarkFirstMessageSent();
    }

    const activeSessionId = sessionId;
    const turnId = createLocalTurnId("walkthrough");
    const startedAt = Date.now();
    const userMessage: ReviewChatMessage = {
      id: `user-${turnId}`,
      role: "user",
      parts: [{ type: "text", text: "/walkthrough" }],
      metadata: {
        command: {
          kind: "review-walkthrough",
          label: "Review walkthrough",
        },
        reviewEffortMode: nextReviewEffortMode,
      },
    };
    const nextMessages = [...chat.messages, userMessage];
    const optimisticActiveTurn: ReviewChatActiveTurn = {
      activitySummary: [],
      errorMessage: null,
      headSha: "",
      kind: "walkthrough",
      progressMessage: "Preparing review context",
      requestMessageId: userMessage.id,
      reviewEffortMode: nextReviewEffortMode,
      runtimeModelChoice: null,
      sessionId: activeSessionId,
      startedAt,
      status: "running",
      turnId,
      updatedAt: startedAt,
    };

    chat.setMessages(nextMessages);
    queryClient.setQueryData<ReviewChatTranscript>(
      reviewChatTranscriptQueryKey(activeSessionId),
      (current) =>
        current
          ? {
              ...current,
              activeTurn: optimisticActiveTurn,
              messages: nextMessages,
            }
          : current,
    );
    setWalkthroughCommandState(activeSessionId, "Preparing review context");
    onOptimisticThinkingChange(true);
    requestAnimationFrame(() => {
      void conversationContextRef.current?.scrollToBottom({
        animation: "smooth",
        ignoreEscapes: true,
      });
    });

    try {
      const transcript = await runReviewWalkthroughTurn(
        activeSessionId,
        turnId,
        nextReviewEffortMode,
        (event) => {
          if (event.sessionId === activeSessionId) {
            setWalkthroughCommandState(activeSessionId, event.message);
            queryClient.setQueryData<ReviewChatTranscript>(
              reviewChatTranscriptQueryKey(activeSessionId),
              (current) =>
                current?.activeTurn
                  ? {
                      ...current,
                      activeTurn: {
                        ...current.activeTurn,
                        progressMessage: event.message,
                        updatedAt: Date.now(),
                      },
                    }
                  : current,
            );
          }
        },
      );
      const messages = transcript.messages as ReviewChatMessage[];
      queryClient.setQueryData(
        reviewChatTranscriptQueryKey(activeSessionId),
        transcript,
      );
      chat.setMessages(messages);
    } catch (error) {
      console.error("Failed to run review walkthrough turn", error);
    } finally {
      onOptimisticThinkingChange(false);
      clearWalkthroughCommandState(activeSessionId);
      onCommitReviewEffortMode(nextReviewEffortMode);
      onClearAttachments();
      requestAnimationFrame(() => {
        void conversationContextRef.current?.scrollToBottom({
          animation: "smooth",
          ignoreEscapes: true,
        });
      });
    }
  }, [
    activeTurn,
    canSend,
    chat,
    conversationContextRef,
    hasSentFirstMessage,
    nextReviewEffortMode,
    onClearAttachments,
    onCommitReviewEffortMode,
    onMarkFirstMessageSent,
    onOptimisticThinkingChange,
    queryClient,
    sessionId,
  ]);

  return {
    handleGenerateWalkthrough,
    isWalkthroughGenerating,
    resetWalkthroughCommand,
    walkthroughProgressMessage,
  };
}

export { useReviewChatWalkthroughCommand };
