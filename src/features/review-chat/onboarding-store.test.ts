import { describe, expect, it } from "bun:test";
import { createJSONStorage } from "zustand/middleware";
import {
  createMemoryStorage,
  createReviewChatOnboardingState,
  createReviewChatOnboardingStore,
  REVIEW_CHAT_ONBOARDING_STORAGE_KEY,
} from "./onboarding-store";

function createStoreWithStorage(initialStorage: Record<string, string> = {}) {
  const storage = createMemoryStorage(initialStorage);
  return createReviewChatOnboardingStore(
    createJSONStorage(() => storage),
  );
}

describe("Rudu chat onboarding store", () => {
  it("starts without a sent first message by default", () => {
    const store = createStoreWithStorage();

    expect(store.getState()).toMatchObject({
      ...createReviewChatOnboardingState(),
      hasSentFirstMessage: false,
    });
  });

  it("persists the first-message flag across store recreation", () => {
    const storage = createMemoryStorage();
    const firstStore = createReviewChatOnboardingStore(
      createJSONStorage(() => storage),
    );

    firstStore.getState().markFirstMessageSent();

    const secondStore = createReviewChatOnboardingStore(
      createJSONStorage(() => storage),
    );

    expect(secondStore.getState().hasSentFirstMessage).toBe(true);
  });

  it("persists only the first-message flag", () => {
    const storage = createMemoryStorage();
    const store = createReviewChatOnboardingStore(
      createJSONStorage(() => storage),
    );

    store.getState().markFirstMessageSent();

    const rawStorageValue = storage.getItem(
      REVIEW_CHAT_ONBOARDING_STORAGE_KEY,
    );
    expect(rawStorageValue).toContain("hasSentFirstMessage");
    expect(rawStorageValue).not.toContain("hasSeenIntro");
  });
});
