import type { ReviewChatTranscript } from "../../../types/github";
import type { ReviewChatEffortMode } from "../composer/mode-toggle";

function reviewChatTranscriptQueryKey(sessionId: string | null) {
  return ["review-chat", "transcript", sessionId ?? "__idle__"] as const;
}

function normalizeReviewEffortMode(
  mode: string | null | undefined,
): ReviewChatEffortMode {
  return mode === "deep" ? "deep" : "fast";
}

function applyTranscriptReviewEffortMode(
  transcript: ReviewChatTranscript | undefined,
  mode: ReviewChatEffortMode,
) {
  if (!transcript) {
    return transcript;
  }

  return {
    ...transcript,
    activeReviewEffortMode: mode,
    pendingReviewEffortMode: null,
  };
}

export {
  applyTranscriptReviewEffortMode,
  normalizeReviewEffortMode,
  reviewChatTranscriptQueryKey,
};
