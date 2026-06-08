import { describe, expect, it } from "bun:test";
import type { ReviewChatEvent, ReviewChatTranscript } from "../../../types/github";
import {
  applyReviewChatEventToActiveTurn,
  applyStartedReviewChatTurn,
  isTerminalReviewChatEvent,
} from "./active-turn-events";

function transcript(): ReviewChatTranscript {
  return {
    activeReviewEffortMode: "fast",
    activeTurn: {
      activitySummary: [],
      errorMessage: null,
      headSha: "head-a",
      kind: "chat",
      progressMessage: "Thinking",
      requestMessageId: "user-turn-1",
      reviewEffortMode: "fast",
      runtimeModelChoice: null,
      sessionId: "session-1",
      startedAt: 1,
      status: "running",
      turnId: "turn-1",
      updatedAt: 1,
    },
    messages: [
      {
        id: "user-turn-1",
        role: "user",
        parts: [{ type: "text", text: "review this" }],
      },
    ],
    pendingReviewEffortMode: null,
    revisionCheckpoints: [],
  };
}

describe("active turn event helpers", () => {
  it("adds the submitted request message when a turn starts", () => {
    const current: ReviewChatTranscript = {
      ...transcript(),
      activeTurn: null,
      messages: [],
    };
    const requestMessage = {
      id: "user-turn-1",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "review this" }],
    };
    const startedTurn = {
      ...transcript().activeTurn!,
      requestMessageId: requestMessage.id,
    };

    const updated = applyStartedReviewChatTurn(
      current,
      startedTurn,
      requestMessage,
    );

    expect(updated?.activeTurn).toEqual(startedTurn);
    expect(updated?.messages).toEqual([requestMessage]);
  });

  it("does not duplicate the submitted request message if it is already cached", () => {
    const current = transcript();
    const requestMessage = current.messages[0] as Parameters<
      typeof applyStartedReviewChatTurn
    >[2];
    const startedTurn = current.activeTurn!;

    const updated = applyStartedReviewChatTurn(
      current,
      startedTurn,
      requestMessage,
    );

    expect(updated?.messages).toEqual(current.messages);
  });

  it("updates active turn progress from live events without changing messages", () => {
    const current = transcript();
    const event: ReviewChatEvent = {
      kind: "tool",
      rawInput: { path: "src/App.tsx" },
      rawOutput: null,
      sessionId: "session-1",
      status: "running",
      title: "Read src/App.tsx",
      toolCallId: "call-1",
      turnId: "turn-1",
    };

    const updated = applyReviewChatEventToActiveTurn(current, event, 42);

    expect(updated?.messages).toBe(current.messages);
    expect(updated?.activeTurn?.progressMessage).toBe("Read src/App.tsx");
    expect(updated?.activeTurn?.updatedAt).toBe(42);
    expect(updated?.activeTurn?.activitySummary).toEqual([
      {
        kind: "tool",
        label: "Read src/App.tsx",
        status: "running",
      },
    ]);
  });

  it("ignores events for stale turns", () => {
    const current = transcript();
    expect(
      applyReviewChatEventToActiveTurn(current, {
        kind: "message",
        sessionId: "session-1",
        text: "stale",
        turnId: "turn-2",
      }),
    ).toBe(current);
  });

  it("marks finished and error events as terminal refetch triggers", () => {
    expect(
      isTerminalReviewChatEvent({
        kind: "finished",
        sessionId: "session-1",
        stopReason: "end_turn",
        turnId: "turn-1",
      }),
    ).toBe(true);
    expect(
      isTerminalReviewChatEvent({
        kind: "error",
        message: "failed",
        sessionId: "session-1",
        turnId: "turn-1",
      }),
    ).toBe(true);
  });
});
