import { useChat } from "@ai-sdk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { ConversationContext } from "../../../components/ai-elements/chat";
import {
  listenReviewChatEvents,
  loadReviewChatTranscript,
  saveReviewChatTranscript,
} from "../../../queries/review-session-native";
import type {
  ReviewChatTranscript,
  ReviewSession,
} from "../../../types/github";
import { getAssistantTurnView } from "../transcript/turn-view";
import {
  normalizeReviewEffortMode,
  reviewChatTranscriptQueryKey,
} from "./transcript-cache";
import {
  TauriAcpChatTransport,
  type ReviewChatMessage,
} from "../runtime/transport";
import {
  applyReviewChatEventToActiveTurn,
  applyStartedReviewChatTurn,
  isTerminalReviewChatEvent,
} from "./active-turn-events";
import { getReviewChatSessionDisplayState } from "./session-display-state";

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
  const chatResetKey = [
    session?.id ?? "__idle__",
    session?.reviewRuntime ?? "__runtime__",
    session?.runtimeModelChoice ?? "__model__",
    session?.agentSessionId ?? "__agent__",
  ].join(":");
  const chat = useChat<ReviewChatMessage>({
    id: chatResetKey,
    transport: new TauriAcpChatTransport({
      onTurnStarted(turn, requestMessage) {
        queryClient.setQueryData(
          reviewChatTranscriptQueryKey(turn.sessionId),
          (current: ReviewChatTranscript | undefined) =>
            applyStartedReviewChatTurn(current, turn, requestMessage),
        );
      },
      sessionId: session?.id ?? null,
    }),
  });
  const transcriptKey = reviewChatTranscriptQueryKey(session?.id ?? null);
  const transcriptQuery = useQuery({
    queryKey: transcriptKey,
    queryFn: () => loadReviewChatTranscript(session?.id ?? "__idle__"),
    enabled: isActive && Boolean(session),
    refetchOnReconnect: "always",
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
  const isAcpChatBusy =
    chat.status === "submitted" || chat.status === "streaming";
  const cachedTranscript = session?.id
    ? queryClient.getQueryData<ReviewChatTranscript>(
        reviewChatTranscriptQueryKey(session.id),
      )
    : undefined;
  const displayState = getReviewChatSessionDisplayState({
    cachedTranscript,
    chatMessages: chat.messages,
    isAcpChatBusy,
    isTranscriptFetching: transcriptQuery.isFetching,
    queryTranscript: transcriptQuery.data,
    sessionId: session?.id ?? null,
  });
  const activeTurn = displayState.activeTurn;
  const transcriptMessages = displayState.transcript?.messages;
  const isChatBusy = isAcpChatBusy || Boolean(activeTurn);
  const isLoadingTranscript = displayState.isRestoringTranscript;
  const isRefreshingTranscript =
    Boolean(session?.id) && transcriptQuery.isFetching && !isAcpChatBusy;
  const canSend =
    isReviewChatReady &&
    Boolean(session) &&
    !isLoadingSession &&
    !isLoadingTranscript &&
    !isRefreshingTranscript &&
    !isChatBusy;

  const setMessages = useCallback(
    (messages: ReviewChatMessage[]) => {
      chat.setMessages(messages);
      if (!session?.id) {
        return;
      }

      queryClient.setQueryData(
        reviewChatTranscriptQueryKey(session.id),
        (current: ReviewChatTranscript | undefined) =>
          current ? { ...current, messages } : current,
      );
    },
    [chat.setMessages, queryClient, session?.id],
  );

  const persistMessages = useCallback(
    async (messages: ReviewChatMessage[]) => {
      if (!session?.id) {
        return;
      }

      const activeSessionId = session.id;
      lastPersistedTranscriptRef.current = JSON.stringify(messages);
      try {
        await saveReviewChatTranscript(activeSessionId, messages);
        queryClient.setQueryData(
          reviewChatTranscriptQueryKey(activeSessionId),
          (current: ReviewChatTranscript | undefined) =>
            current ? { ...current, messages } : current,
        );
      } catch (error) {
        lastPersistedTranscriptRef.current = null;
        throw error;
      }
    },
    [queryClient, session?.id],
  );

  useEffect(() => {
    setIsOptimisticThinkingVisible(false);
    lastPersistedTranscriptRef.current = null;
    lastCompletionScrollKeyRef.current = null;
    wasChatBusyRef.current = false;
    onSessionReset();

    if (!session?.id) {
      chat.setMessages([]);
      return;
    }

    const cachedTranscript = queryClient.getQueryData<ReviewChatTranscript>(
      reviewChatTranscriptQueryKey(session.id),
    );
    const messages = (cachedTranscript?.messages ?? []) as ReviewChatMessage[];
    chat.setMessages(messages);
    if (cachedTranscript) {
      lastPersistedTranscriptRef.current = JSON.stringify(messages);
    }
  }, [chat.setMessages, chatResetKey, onSessionReset, queryClient, session?.id]);

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

    const messages = transcriptMessages as ReviewChatMessage[];
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
    transcriptMessages,
    transcriptQuery.data?.activeReviewEffortMode,
    transcriptQuery.data?.pendingReviewEffortMode,
    transcriptQuery.isSuccess,
  ]);

  useEffect(() => {
    if (!isActive || !session?.id) {
      return;
    }

    const activeSessionId = session.id;
    let isDisposed = false;
    let unlistenReviewChatEvents: (() => void) | null = null;

    void listenReviewChatEvents((event) => {
      if (event.sessionId !== activeSessionId) {
        return;
      }

      if (isTerminalReviewChatEvent(event)) {
        void loadReviewChatTranscript(activeSessionId)
          .then((transcript) => {
            if (isDisposed) {
              return;
            }
            const messages = transcript.messages as ReviewChatMessage[];
            lastPersistedTranscriptRef.current = JSON.stringify(messages);
            queryClient.setQueryData(
              reviewChatTranscriptQueryKey(activeSessionId),
              transcript,
            );
            chat.setMessages(messages);
          })
          .catch((error) => {
            console.error("Failed to refresh completed review chat turn", error);
          });
        return;
      }

      queryClient.setQueryData(
        reviewChatTranscriptQueryKey(activeSessionId),
        (current: ReviewChatTranscript | undefined) =>
          applyReviewChatEventToActiveTurn(current, event),
      );
    })
      .then((unlisten) => {
        if (isDisposed) {
          unlisten();
          return;
        }
        unlistenReviewChatEvents = unlisten;
      })
      .catch((error) => {
        console.error("Failed to listen for review chat events", error);
      });

    return () => {
      isDisposed = true;
      unlistenReviewChatEvents?.();
    };
  }, [chat.setMessages, isActive, queryClient, session?.id]);

  useEffect(() => {
    if (!session?.id || !transcriptQuery.isSuccess || isAcpChatBusy) {
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

    if (activeTurn) {
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
    activeTurn,
    isAcpChatBusy,
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
    activeTurn,
    canSend,
    chat,
    isAcpChatBusy,
    isChatBusy,
    isLoadingTranscript,
    isOptimisticThinkingVisible,
    messages: displayState.messages,
    persistMessages,
    setMessages,
    setIsOptimisticThinkingVisible,
    transcriptQuery,
  };
}

export { useReviewChatSession };
