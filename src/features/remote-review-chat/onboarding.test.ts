import { describe, expect, it } from "bun:test";
import {
  getRemoteReviewChatPrimaryActionLabel,
  REMOTE_REVIEW_CHAT_STARTER_PROMPTS,
  shouldAutoOpenRemoteReviewChatIntro,
  shouldShowRemoteReviewChatStarterPrompts,
} from "./onboarding";

describe("remote review chat onboarding helpers", () => {
  it("auto-opens the intro only on the first active AI chat visit", () => {
    expect(
      shouldAutoOpenRemoteReviewChatIntro({
        hasSeenIntro: false,
        isActive: true,
        isIntroOpen: false,
      }),
    ).toBe(true);

    expect(
      shouldAutoOpenRemoteReviewChatIntro({
        hasSeenIntro: true,
        isActive: true,
        isIntroOpen: false,
      }),
    ).toBe(false);

    expect(
      shouldAutoOpenRemoteReviewChatIntro({
        hasSeenIntro: false,
        isActive: false,
        isIntroOpen: false,
      }),
    ).toBe(false);

    expect(
      shouldAutoOpenRemoteReviewChatIntro({
        hasSeenIntro: false,
        isActive: true,
        isIntroOpen: true,
      }),
    ).toBe(false);
  });

  it("switches the primary CTA label based on Worker configuration", () => {
    expect(getRemoteReviewChatPrimaryActionLabel(false)).toBe(
      "Continue to setup",
    );
    expect(getRemoteReviewChatPrimaryActionLabel(true)).toBe("Start AI chat");
  });

  it("shows starter prompts only before the first sent message", () => {
    expect(
      shouldShowRemoteReviewChatStarterPrompts({
        hasSentFirstMessage: false,
        workerConfigured: true,
      }),
    ).toBe(true);
    expect(
      shouldShowRemoteReviewChatStarterPrompts({
        hasSentFirstMessage: true,
        workerConfigured: true,
      }),
    ).toBe(false);
    expect(
      shouldShowRemoteReviewChatStarterPrompts({
        hasSentFirstMessage: false,
        workerConfigured: false,
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
