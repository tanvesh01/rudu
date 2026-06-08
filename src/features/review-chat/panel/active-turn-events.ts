import type {
  ReviewChatActiveTurn,
  ReviewChatActiveTurnActivityItem,
  ReviewChatEvent,
  ReviewChatTranscript,
} from "../../../types/github";
import type { ReviewChatMessage } from "../runtime/transport";

function visibleToolLabel(title: string | null) {
  const label = title?.trim() ?? "";
  if (
    !label ||
    label.includes("|fc_") ||
    label.startsWith("call_") ||
    label.startsWith("fc_")
  ) {
    return "Using tool";
  }

  return label;
}

function activityForReviewChatEvent(event: ReviewChatEvent): {
  progressMessage: string;
  activitySummary: ReviewChatActiveTurnActivityItem[];
} | null {
  if (event.kind === "message") {
    return {
      activitySummary: [{ kind: "progress", label: "Writing response" }],
      progressMessage: "Writing response",
    };
  }

  if (event.kind === "thought") {
    return {
      activitySummary: [{ kind: "progress", label: "Thinking" }],
      progressMessage: "Thinking",
    };
  }

  if (event.kind === "plan") {
    return {
      activitySummary: [{ kind: "plan", label: "Planning next steps" }],
      progressMessage: "Planning next steps",
    };
  }

  if (event.kind === "tool") {
    const label = visibleToolLabel(event.title);
    return {
      activitySummary: [{ kind: "tool", label, status: event.status }],
      progressMessage: label,
    };
  }

  return null;
}

function applyReviewChatEventToActiveTurn(
  transcript: ReviewChatTranscript | undefined,
  event: ReviewChatEvent,
  updatedAt = Date.now(),
) {
  const activity = activityForReviewChatEvent(event);
  if (
    !activity ||
    !transcript?.activeTurn ||
    transcript.activeTurn.turnId !== event.turnId
  ) {
    return transcript;
  }

  return {
    ...transcript,
    activeTurn: {
      ...transcript.activeTurn,
      activitySummary: activity.activitySummary,
      progressMessage: activity.progressMessage,
      updatedAt,
    },
  };
}

function applyStartedReviewChatTurn(
  transcript: ReviewChatTranscript | undefined,
  turn: ReviewChatActiveTurn,
  requestMessage: ReviewChatMessage,
): ReviewChatTranscript | undefined {
  if (!transcript) {
    return transcript;
  }

  const messages = transcript.messages as ReviewChatMessage[];
  const hasRequestMessage = messages.some(
    (message) => message.id === requestMessage.id,
  );

  return {
    ...transcript,
    activeTurn: turn,
    messages: hasRequestMessage ? messages : [...messages, requestMessage],
  };
}

function isTerminalReviewChatEvent(event: ReviewChatEvent) {
  return event.kind === "finished" || event.kind === "error";
}

export {
  applyReviewChatEventToActiveTurn,
  applyStartedReviewChatTurn,
  isTerminalReviewChatEvent,
};
