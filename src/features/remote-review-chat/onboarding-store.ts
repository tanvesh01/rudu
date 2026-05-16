import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";

const REMOTE_REVIEW_CHAT_ONBOARDING_STORAGE_KEY =
  "rudu-remote-review-chat-onboarding";

type RemoteReviewChatOnboardingState = {
  hasSeenIntro: boolean;
  hasSentFirstMessage: boolean;
  isIntroOpen: boolean;
  openIntro(): void;
  closeIntro(): void;
  markIntroSeen(): void;
  markFirstMessageSent(): void;
};

type RemoteReviewChatOnboardingPersistedState = Pick<
  RemoteReviewChatOnboardingState,
  "hasSeenIntro" | "hasSentFirstMessage"
>;

const REMOTE_REVIEW_CHAT_ONBOARDING_INITIAL_STATE = {
  hasSeenIntro: false,
  hasSentFirstMessage: false,
  isIntroOpen: false,
} satisfies Pick<
  RemoteReviewChatOnboardingState,
  "hasSeenIntro" | "hasSentFirstMessage" | "isIntroOpen"
>;

function createRemoteReviewChatOnboardingState() {
  return {
    ...REMOTE_REVIEW_CHAT_ONBOARDING_INITIAL_STATE,
    openIntro: () => undefined,
    closeIntro: () => undefined,
    markIntroSeen: () => undefined,
    markFirstMessageSent: () => undefined,
  } satisfies RemoteReviewChatOnboardingState;
}

function browserStorage() {
  return createJSONStorage<RemoteReviewChatOnboardingPersistedState>(
    () => localStorage,
  );
}

function createRemoteReviewChatOnboardingStore(storage = browserStorage()) {
  return create<RemoteReviewChatOnboardingState>()(
    persist(
      (set) => ({
        ...REMOTE_REVIEW_CHAT_ONBOARDING_INITIAL_STATE,
        openIntro: () => set({ isIntroOpen: true }),
        closeIntro: () => set({ isIntroOpen: false }),
        markIntroSeen: () => set({ hasSeenIntro: true }),
        markFirstMessageSent: () => set({ hasSentFirstMessage: true }),
      }),
      {
        name: REMOTE_REVIEW_CHAT_ONBOARDING_STORAGE_KEY,
        storage,
        partialize: (state) => ({
          hasSeenIntro: state.hasSeenIntro,
          hasSentFirstMessage: state.hasSentFirstMessage,
        }),
      },
    ),
  );
}

function createMemoryStorage(initial: Record<string, string> = {}): StateStorage {
  const values = new Map(Object.entries(initial));

  return {
    getItem: (name) => values.get(name) ?? null,
    removeItem: (name) => {
      values.delete(name);
    },
    setItem: (name, value) => {
      values.set(name, value);
    },
  };
}

const useRemoteReviewChatOnboardingStore =
  createRemoteReviewChatOnboardingStore();

export {
  createMemoryStorage,
  createRemoteReviewChatOnboardingState,
  createRemoteReviewChatOnboardingStore,
  REMOTE_REVIEW_CHAT_ONBOARDING_INITIAL_STATE,
  REMOTE_REVIEW_CHAT_ONBOARDING_STORAGE_KEY,
  useRemoteReviewChatOnboardingStore,
};
export type {
  RemoteReviewChatOnboardingPersistedState,
  RemoteReviewChatOnboardingState,
};
