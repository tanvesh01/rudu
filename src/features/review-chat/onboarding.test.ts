import { describe, expect, it } from "bun:test";
import {
  REVIEW_CHAT_STARTER_PROMPTS,
  shouldShowReviewChatStarterPrompts,
} from "./onboarding";

describe("Rudu chat onboarding helpers", () => {
  it("shows starter prompts only before the first sent message", () => {
    expect(
      shouldShowReviewChatStarterPrompts({
        hasSentFirstMessage: false,
        hasSession: true,
      }),
    ).toBe(true);
    expect(
      shouldShowReviewChatStarterPrompts({
        hasSentFirstMessage: true,
        hasSession: true,
      }),
    ).toBe(false);
    expect(
      shouldShowReviewChatStarterPrompts({
        hasSentFirstMessage: false,
        hasSession: false,
      }),
    ).toBe(false);
  });

  it("keeps the starter prompts aligned with the onboarding copy", () => {
    expect(REVIEW_CHAT_STARTER_PROMPTS).toEqual([
      "Summarize this PR",
      "What files should I inspect first?",
      "What looks risky here?",
    ]);
  });
});
