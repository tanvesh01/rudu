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
  it("starts unseen and unopened by default", () => {
    const store = createStoreWithStorage();

    expect(store.getState()).toMatchObject({
      ...createRemoteReviewChatOnboardingState(),
      hasSeenIntro: false,
      hasSentFirstMessage: false,
      isIntroOpen: false,
    });
  });

  it("persists intro and first-message flags across store recreation", () => {
    const storage = createMemoryStorage();
    const firstStore = createRemoteReviewChatOnboardingStore(
      createJSONStorage(() => storage),
    );

    firstStore.getState().markIntroSeen();
    firstStore.getState().markFirstMessageSent();

    const secondStore = createRemoteReviewChatOnboardingStore(
      createJSONStorage(() => storage),
    );

    expect(secondStore.getState().hasSeenIntro).toBe(true);
    expect(secondStore.getState().hasSentFirstMessage).toBe(true);
  });

  it("does not persist the ephemeral dialog open state", () => {
    const storage = createMemoryStorage();
    const firstStore = createRemoteReviewChatOnboardingStore(
      createJSONStorage(() => storage),
    );

    firstStore.getState().openIntro();
    firstStore.getState().markIntroSeen();

    const rawStorageValue = storage.getItem(
      REMOTE_REVIEW_CHAT_ONBOARDING_STORAGE_KEY,
    );
    expect(rawStorageValue).not.toContain("isIntroOpen");

    const secondStore = createRemoteReviewChatOnboardingStore(
      createJSONStorage(() => storage),
    );
    expect(secondStore.getState().isIntroOpen).toBe(false);
    expect(secondStore.getState().hasSeenIntro).toBe(true);
  });
});
