const REMOTE_REVIEW_CHAT_STARTER_PROMPTS = [
  "Summarize this PR",
  "What files should I inspect first?",
  "What looks risky here?",
] as const;

function shouldAutoOpenRemoteReviewChatIntro(input: {
  hasSeenIntro: boolean;
  isActive: boolean;
  isIntroOpen: boolean;
}) {
  return input.isActive && !input.hasSeenIntro && !input.isIntroOpen;
}

function shouldShowRemoteReviewChatStarterPrompts(input: {
  hasSentFirstMessage: boolean;
  hasSession: boolean;
}) {
  return input.hasSession && !input.hasSentFirstMessage;
}

function getRemoteReviewChatPrimaryActionLabel() {
  return "Start AI chat";
}

export {
  getRemoteReviewChatPrimaryActionLabel,
  REMOTE_REVIEW_CHAT_STARTER_PROMPTS,
  shouldAutoOpenRemoteReviewChatIntro,
  shouldShowRemoteReviewChatStarterPrompts,
};
