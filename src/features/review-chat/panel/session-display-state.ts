import type { ReviewChatTranscript } from "../../../types/github";
import type { ReviewChatMessage } from "../runtime/transport";

type ReviewChatSessionDisplayStateInput = {
  cachedTranscript: ReviewChatTranscript | undefined;
  chatMessages: ReviewChatMessage[];
  isAcpChatBusy: boolean;
  isTranscriptFetching: boolean;
  queryTranscript: ReviewChatTranscript | undefined;
  sessionId: string | null;
};

function getReviewChatSessionDisplayState({
  cachedTranscript,
  chatMessages,
  isAcpChatBusy,
  isTranscriptFetching,
  queryTranscript,
  sessionId,
}: ReviewChatSessionDisplayStateInput) {
  if (!sessionId) {
    return {
      activeTurn: null,
      isRestoringTranscript: false,
      messages: [] as ReviewChatMessage[],
      transcript: undefined,
    };
  }

  const transcript = queryTranscript ?? cachedTranscript;
  const transcriptMessages = transcript?.messages as
    | ReviewChatMessage[]
    | undefined;

  return {
    activeTurn: transcript?.activeTurn ?? null,
    isRestoringTranscript: !transcript && isTranscriptFetching,
    messages: isAcpChatBusy ? chatMessages : (transcriptMessages ?? []),
    transcript,
  };
}

export { getReviewChatSessionDisplayState };
