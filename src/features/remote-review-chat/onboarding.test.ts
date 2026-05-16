import { describe, expect, it } from "bun:test";
import {
  REMOTE_REVIEW_CHAT_STARTER_PROMPTS,
  shouldShowRemoteReviewChatStarterPrompts,
} from "./onboarding";

describe("remote review chat onboarding helpers", () => {
  it("shows starter prompts only before the first sent message", () => {
    expect(
      shouldShowRemoteReviewChatStarterPrompts({
        hasSentFirstMessage: false,
        hasSession: true,
      }),
    ).toBe(true);
    expect(
      shouldShowRemoteReviewChatStarterPrompts({
        hasSentFirstMessage: true,
        hasSession: true,
      }),
    ).toBe(false);
    expect(
      shouldShowRemoteReviewChatStarterPrompts({
        hasSentFirstMessage: false,
        hasSession: false,
      }),
    ).toBe(false);
  });

  it("keeps the starter prompts aligned with the onboarding copy", () => {
    expect(REMOTE_REVIEW_CHAT_STARTER_PROMPTS).toEqual([
      "Summarize this PR",
      "What files should I inspect first?",
      "What looks risky here?",
    ]);
  });
});
