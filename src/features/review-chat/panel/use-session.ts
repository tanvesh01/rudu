import { useChat } from "@ai-sdk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { ConversationContext } from "../../../components/ai-elements/chat";
import {
  loadReviewChatTranscript,
  saveReviewChatTranscript,
} from "../../../queries/review-session-native";
import type { ReviewSession } from "../../../types/github";
import { getAssistantTurnView } from "../transcript/turn-view";
import {
  normalizeReviewEffortMode,
  reviewChatTranscriptQueryKey,
} from "./transcript-cache";
import {
  TauriAcpChatTransport,
  type ReviewChatMessage,
} from "../runtime/transport";

type UseReviewChatSessionOptions = {
  conversationContextRef: RefObject<ConversationContext | null>;
  isActive: boolean;
  isLoadingSession: boolean;
  isReviewChatReady: boolean;
  session: ReviewSession | null;
  onRestoreReviewEffortMode(mode: "fast" | "deep"): void;
  onRestorePendingReviewEffortMode(mode: "fast" | "deep" | null): void;
  onSessionReset(): void;
};

function useReviewChatSession({
  conversationContextRef,
  isActive,
  isLoadingSession,
  isReviewChatReady,
  session,
  onRestorePendingReviewEffortMode,
  onRestoreReviewEffortMode,
  onSessionReset,
}: UseReviewChatSessionOptions) {
  const queryClient = useQueryClient();
  const lastPersistedTranscriptRef = useRef<string | null>(null);
  const lastCompletionScrollKeyRef = useRef<string | null>(null);
  const wasChatBusyRef = useRef(false);
  const [isOptimisticThinkingVisible, setIsOptimisticThinkingVisible] =
    useState(false);
  const chat = useChat<ReviewChatMessage>({
    id: session?.id ?? "review-chat-idle",
    transport: new TauriAcpChatTransport({
      reviewRuntime: session?.reviewRuntime ?? "codex",
      sessionId: session?.id ?? null,
    }),
  });
  const transcriptQuery = useQuery({
    queryKey: reviewChatTranscriptQueryKey(session?.id ?? null),
    queryFn: () => loadReviewChatTranscript(session?.id ?? "__idle__"),
    enabled: isActive && Boolean(session),
  });
  const isAcpChatBusy =
    chat.status === "submitted" || chat.status === "streaming";
  const isChatBusy = isAcpChatBusy;
  const isLoadingTranscript = transcriptQuery.isLoading;
  const canSend =
    isReviewChatReady &&
    Boolean(session) &&
    !isLoadingSession &&
    !isLoadingTranscript &&
    !isChatBusy;

  useEffect(() => {
    setIsOptimisticThinkingVisible(false);
    lastPersistedTranscriptRef.current = null;
    lastCompletionScrollKeyRef.current = null;
    wasChatBusyRef.current = false;
    onSessionReset();
  }, [onSessionReset, session?.id]);

  useEffect(() => {
    const latestMessage = chat.messages[chat.messages.length - 1];
    if (isChatBusy || latestMessage?.role === "assistant") {
      setIsOptimisticThinkingVisible(false);
    }
  }, [chat.messages, isChatBusy]);

  useEffect(() => {
    if (!session?.id || !transcriptQuery.isSuccess || !transcriptQuery.data) {
      return;
    }

    const messages = transcriptQuery.data.messages as ReviewChatMessage[];
    chat.setMessages(messages);
    onRestoreReviewEffortMode(
      normalizeReviewEffortMode(transcriptQuery.data.activeReviewEffortMode),
    );
    onRestorePendingReviewEffortMode(
      transcriptQuery.data.pendingReviewEffortMode
        ? normalizeReviewEffortMode(transcriptQuery.data.pendingReviewEffortMode)
        : null,
    );
    lastPersistedTranscriptRef.current = JSON.stringify(messages);
  }, [
    chat.setMessages,
    onRestorePendingReviewEffortMode,
    onRestoreReviewEffortMode,
    session?.id,
    transcriptQuery.data,
    transcriptQuery.isSuccess,
  ]);

  useEffect(() => {
    if (!session?.id || !transcriptQuery.isSuccess || isChatBusy) {
      return;
    }
    if (chat.messages.length === 0) {
      return;
    }
    if (
      !chat.messages.some(
        (message) =>
          message.role === "assistant" &&
          typeof message.metadata?.finishedAt === "number",
      )
    ) {
      return;
    }

    const serializedMessages = JSON.stringify(chat.messages);
    if (serializedMessages === lastPersistedTranscriptRef.current) {
      return;
    }

    lastPersistedTranscriptRef.current = serializedMessages;
    const activeSessionId = session.id;
    void saveReviewChatTranscript(activeSessionId, chat.messages)
      .then(() => {
        queryClient.setQueryData(
          reviewChatTranscriptQueryKey(activeSessionId),
          (current: typeof transcriptQuery.data) =>
            current ? { ...current, messages: chat.messages } : current,
        );
      })
      .catch((error) => {
        lastPersistedTranscriptRef.current = null;
        console.error("Failed to persist review chat transcript", error);
      });
  }, [
    chat.messages,
    isChatBusy,
    queryClient,
    session?.id,
    transcriptQuery.data,
    transcriptQuery.isSuccess,
  ]);

  useEffect(() => {
    const wasChatBusy = wasChatBusyRef.current;
    wasChatBusyRef.current = isChatBusy;

    if (isChatBusy || !wasChatBusy) {
      return;
    }

    const latestMessage = chat.messages[chat.messages.length - 1];
    if (!latestMessage || latestMessage.role !== "assistant") {
      return;
    }

    const finishedAt = latestMessage.metadata?.finishedAt;
    if (typeof finishedAt !== "number") {
      return;
    }

    const turnView = getAssistantTurnView(latestMessage.parts);
    if (!turnView.finalText.trim()) {
      return;
    }

    const scrollKey = `${latestMessage.id}:${finishedAt}:${turnView.finalText.length}`;
    if (lastCompletionScrollKeyRef.current === scrollKey) {
      return;
    }

    lastCompletionScrollKeyRef.current = scrollKey;
    requestAnimationFrame(() => {
      void conversationContextRef.current?.scrollToBottom({
        animation: "smooth",
        ignoreEscapes: true,
      });
    });
  }, [chat.messages, conversationContextRef, isChatBusy]);

  return {
    canSend,
    chat,
    isAcpChatBusy,
    isChatBusy,
    isLoadingTranscript,
    isOptimisticThinkingVisible,
    setIsOptimisticThinkingVisible,
    transcriptQuery,
  };
}

export { useReviewChatSession };
