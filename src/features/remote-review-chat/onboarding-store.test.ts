import { describe, expect, it } from "bun:test";
import { createJSONStorage } from "zustand/middleware";
import {
  createMemoryStorage,
  createRemoteReviewChatOnboardingState,
  createRemoteReviewChatOnboardingStore,
  REMOTE_REVIEW_CHAT_ONBOARDING_STORAGE_KEY,
} from "./onboarding-store";

function createStoreWithStorage(initialStorage: Record<string, string> = {}) {
  const storage = createMemoryStorage(initialStorage);
  return createRemoteReviewChatOnboardingStore(
    createJSONStorage(() => storage),
  );
}

describe("remote review chat onboarding store", () => {
  it("starts without a sent first message by default", () => {
    const store = createStoreWithStorage();

    expect(store.getState()).toMatchObject({
      ...createRemoteReviewChatOnboardingState(),
      hasSentFirstMessage: false,
    });
  });

  it("persists the first-message flag across store recreation", () => {
    const storage = createMemoryStorage();
    const firstStore = createRemoteReviewChatOnboardingStore(
      createJSONStorage(() => storage),
    );

    firstStore.getState().markFirstMessageSent();

    const secondStore = createRemoteReviewChatOnboardingStore(
      createJSONStorage(() => storage),
    );

    expect(secondStore.getState().hasSentFirstMessage).toBe(true);
  });

  it("persists only the first-message flag", () => {
    const storage = createMemoryStorage();
    const store = createRemoteReviewChatOnboardingStore(
      createJSONStorage(() => storage),
    );

    store.getState().markFirstMessageSent();

    const rawStorageValue = storage.getItem(
      REMOTE_REVIEW_CHAT_ONBOARDING_STORAGE_KEY,
    );
    expect(rawStorageValue).toContain("hasSentFirstMessage");
    expect(rawStorageValue).not.toContain("hasSeenIntro");
  });
});
