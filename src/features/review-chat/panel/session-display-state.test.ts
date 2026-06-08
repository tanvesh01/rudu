import { describe, expect, it } from "bun:test";
import type { ReviewChatTranscript } from "../../../types/github";
import type { ReviewChatMessage } from "../runtime/transport";
import { getReviewChatSessionDisplayState } from "./session-display-state";

const oldPrMessage: ReviewChatMessage = {
  id: "old-user",
  parts: [{ type: "text", text: "old PR question" }],
  role: "user",
};

const activeUserMessage: ReviewChatMessage = {
  id: "active-user",
  parts: [{ type: "text", text: "active PR question" }],
  role: "user",
};

const completedAssistantMessage: ReviewChatMessage = {
  id: "assistant-final",
  metadata: { finishedAt: 10 },
  parts: [{ type: "text", text: "done" }],
  role: "assistant",
};

function activeTranscript(): ReviewChatTranscript {
  return {
    activeReviewEffortMode: "fast",
    activeTurn: {
      activitySummary: [],
      errorMessage: null,
      headSha: "head-a",
      kind: "chat",
      progressMessage: "Thinking",
      requestMessageId: activeUserMessage.id,
      reviewEffortMode: "fast",
      runtimeModelChoice: null,
      sessionId: "session-a",
      startedAt: 1,
      status: "running",
      turnId: "turn-a",
      updatedAt: 1,
    },
    messages: [activeUserMessage],
    pendingReviewEffortMode: null,
    revisionCheckpoints: [],
  };
}

describe("review chat session display state", () => {
  it("renders cached active turn messages immediately when switching back to a PR", () => {
    const state = getReviewChatSessionDisplayState({
      cachedTranscript: activeTranscript(),
      chatMessages: [oldPrMessage],
      isAcpChatBusy: false,
      isTranscriptFetching: true,
      queryTranscript: undefined,
      sessionId: "session-a",
    });

    expect(state.messages).toEqual([activeUserMessage]);
    expect(state.activeTurn?.progressMessage).toBe("Thinking");
    expect(state.isRestoringTranscript).toBe(false);
  });

  it("does not show previous PR messages while a new PR transcript is loading", () => {
    const state = getReviewChatSessionDisplayState({
      cachedTranscript: undefined,
      chatMessages: [oldPrMessage],
      isAcpChatBusy: false,
      isTranscriptFetching: true,
      queryTranscript: undefined,
      sessionId: "session-b",
    });

    expect(state.messages).toEqual([]);
    expect(state.activeTurn).toBeNull();
    expect(state.isRestoringTranscript).toBe(true);
  });

  it("uses DB transcript over stale cache after remount refetch completes", () => {
    const completedTranscript: ReviewChatTranscript = {
      ...activeTranscript(),
      activeTurn: null,
      messages: [activeUserMessage, completedAssistantMessage],
    };

    const state = getReviewChatSessionDisplayState({
      cachedTranscript: activeTranscript(),
      chatMessages: [oldPrMessage],
      isAcpChatBusy: false,
      isTranscriptFetching: false,
      queryTranscript: completedTranscript,
      sessionId: "session-a",
    });

    expect(state.messages).toEqual([
      activeUserMessage,
      completedAssistantMessage,
    ]);
    expect(state.activeTurn).toBeNull();
    expect(state.isRestoringTranscript).toBe(false);
  });

  it("keeps live useChat messages while the mounted ACP stream is active", () => {
    const liveAssistantMessage: ReviewChatMessage = {
      id: "assistant-live",
      parts: [{ type: "text", text: "streaming" }],
      role: "assistant",
    };

    const state = getReviewChatSessionDisplayState({
      cachedTranscript: activeTranscript(),
      chatMessages: [activeUserMessage, liveAssistantMessage],
      isAcpChatBusy: true,
      isTranscriptFetching: true,
      queryTranscript: activeTranscript(),
      sessionId: "session-a",
    });

    expect(state.messages).toEqual([activeUserMessage, liveAssistantMessage]);
    expect(state.activeTurn?.turnId).toBe("turn-a");
  });
});
