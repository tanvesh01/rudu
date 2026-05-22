const REVIEW_CHAT_STARTER_PROMPTS = [
  "Summarize this PR",
  "What files should I inspect first?",
  "What looks risky here?",
] as const;

function shouldShowReviewChatStarterPrompts(input: {
  hasSentFirstMessage: boolean;
  hasSession: boolean;
}) {
  return input.hasSession && !input.hasSentFirstMessage;
}

export {
  REVIEW_CHAT_STARTER_PROMPTS,
  shouldShowReviewChatStarterPrompts,
};
