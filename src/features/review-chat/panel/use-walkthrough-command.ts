import { useCallback, useEffect, useState, type RefObject } from "react";
import type { ConversationContext } from "../../../components/ai-elements/chat";
import { getErrorMessage } from "../../../hooks/useGithubQueries";
import { generateReviewWalkthrough } from "../../../queries/review-session-native";
import type { ReviewChatEffortMode } from "../composer/mode-toggle";
import type { ReviewChatMessage } from "../runtime/transport";

type ReviewChatMessageController = {
  messages: ReviewChatMessage[];
  setMessages(messages: ReviewChatMessage[]): void;
};

type UseReviewChatWalkthroughCommandOptions = {
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
  const [isWalkthroughGenerating, setIsWalkthroughGenerating] = useState(false);
  const [walkthroughProgressMessage, setWalkthroughProgressMessage] =
    useState("Generating walkthrough");

  const resetWalkthroughCommand = useCallback(() => {
    setIsWalkthroughGenerating(false);
    setWalkthroughProgressMessage("Generating walkthrough");
  }, []);

  useEffect(() => {
    resetWalkthroughCommand();
  }, [resetWalkthroughCommand, sessionId]);

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

    chat.setMessages(nextMessages);
    setIsWalkthroughGenerating(true);
    setWalkthroughProgressMessage("Preparing review context");
    onOptimisticThinkingChange(true);
    requestAnimationFrame(() => {
      void conversationContextRef.current?.scrollToBottom({
        animation: "smooth",
        ignoreEscapes: true,
      });
    });

    try {
      const walkthrough = await generateReviewWalkthrough(
        activeSessionId,
        (event) => {
          if (event.sessionId === activeSessionId) {
            setWalkthroughProgressMessage(event.message);
          }
        },
      );
      const assistantMessage: ReviewChatMessage = {
        id: `assistant-${turnId}`,
        role: "assistant",
        parts: [
          {
            type: "data-review-walkthrough",
            id: "review-walkthrough",
            data: walkthrough,
          },
        ],
        metadata: {
          finishedAt: Date.now(),
          startedAt,
          turnId,
        },
      };
      chat.setMessages([...nextMessages, assistantMessage]);
    } catch (error) {
      const message = getErrorMessage(error);
      const assistantMessage: ReviewChatMessage = {
        id: `assistant-${turnId}`,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `Review walkthrough failed: ${message}`,
          },
        ],
        metadata: {
          finishedAt: Date.now(),
          startedAt,
          turnId,
        },
      };
      chat.setMessages([...nextMessages, assistantMessage]);
    } finally {
      onOptimisticThinkingChange(false);
      setIsWalkthroughGenerating(false);
      setWalkthroughProgressMessage("Generating walkthrough");
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
    canSend,
    chat,
    conversationContextRef,
    hasSentFirstMessage,
    nextReviewEffortMode,
    onClearAttachments,
    onCommitReviewEffortMode,
    onMarkFirstMessageSent,
    onOptimisticThinkingChange,
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
