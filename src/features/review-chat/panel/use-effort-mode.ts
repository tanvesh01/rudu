import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState, type RefObject } from "react";
import {
  setPendingReviewChatEffortMode,
  setReviewChatEffortMode,
} from "../../../queries/review-session-native";
import type { ReviewChatTranscript } from "../../../types/github";
import type { ReviewChatEffortMode } from "../composer/mode-toggle";
import {
  applyTranscriptReviewEffortMode,
  reviewChatTranscriptQueryKey,
} from "./transcript-cache";

type UseReviewChatEffortModeOptions = {
  isChatBusyRef: RefObject<boolean>;
  messageCountRef: RefObject<number>;
  sessionId: string | null;
  onRefetchTranscript(): void;
};

function useReviewChatEffortMode({
  isChatBusyRef,
  messageCountRef,
  sessionId,
  onRefetchTranscript,
}: UseReviewChatEffortModeOptions) {
  const queryClient = useQueryClient();
  const [reviewEffortMode, setReviewEffortMode] =
    useState<ReviewChatEffortMode>("fast");
  const [pendingReviewEffortMode, setPendingReviewEffortMode] =
    useState<ReviewChatEffortMode | null>(null);
  const nextReviewEffortMode = pendingReviewEffortMode ?? reviewEffortMode;

  const resetReviewEffortMode = useCallback(() => {
    setReviewEffortMode("fast");
    setPendingReviewEffortMode(null);
  }, []);

  const restoreReviewEffortMode = useCallback((mode: ReviewChatEffortMode) => {
    setReviewEffortMode(mode);
  }, []);

  const restorePendingReviewEffortMode = useCallback(
    (mode: ReviewChatEffortMode | null) => {
      setPendingReviewEffortMode(mode);
    },
    [],
  );

  const commitReviewEffortMode = useCallback(
    (mode: ReviewChatEffortMode) => {
      if (sessionId && pendingReviewEffortMode) {
        queryClient.setQueryData<ReviewChatTranscript>(
          reviewChatTranscriptQueryKey(sessionId),
          (current) => applyTranscriptReviewEffortMode(current, mode),
        );
      }
      setReviewEffortMode(mode);
      setPendingReviewEffortMode(null);
    },
    [pendingReviewEffortMode, queryClient, sessionId],
  );

  const commitReviewEffortModeLocal = useCallback(
    (mode: ReviewChatEffortMode) => {
      setReviewEffortMode(mode);
      setPendingReviewEffortMode(null);
    },
    [],
  );

  const handleReviewEffortModeChange = useCallback(
    (mode: ReviewChatEffortMode) => {
      if (!sessionId) return;
      const activeSessionId = sessionId;
      if (isChatBusyRef.current) {
        setPendingReviewEffortMode(mode);
        queryClient.setQueryData<ReviewChatTranscript>(
          reviewChatTranscriptQueryKey(activeSessionId),
          (current) =>
            current ? { ...current, pendingReviewEffortMode: mode } : current,
        );
        void setPendingReviewChatEffortMode(activeSessionId, mode).catch(
          (error) => {
            console.error("Failed to persist pending review effort mode", error);
            setPendingReviewEffortMode(null);
            onRefetchTranscript();
          },
        );
        return;
      }

      const previousMode = reviewEffortMode;
      setReviewEffortMode(mode);
      setPendingReviewEffortMode(null);
      queryClient.setQueryData<ReviewChatTranscript>(
        reviewChatTranscriptQueryKey(activeSessionId),
        (current) => applyTranscriptReviewEffortMode(current, mode),
      );
      void setReviewChatEffortMode(
        activeSessionId,
        mode,
        messageCountRef.current,
      ).catch((error) => {
        console.error("Failed to persist review effort mode", error);
        setReviewEffortMode(previousMode);
        onRefetchTranscript();
      });
    },
    [
      isChatBusyRef,
      messageCountRef,
      onRefetchTranscript,
      queryClient,
      reviewEffortMode,
      sessionId,
    ],
  );

  return {
    commitReviewEffortMode,
    commitReviewEffortModeLocal,
    handleReviewEffortModeChange,
    nextReviewEffortMode,
    pendingReviewEffortMode,
    resetReviewEffortMode,
    restorePendingReviewEffortMode,
    restoreReviewEffortMode,
    reviewEffortMode,
  };
}

export { useReviewChatEffortMode };
