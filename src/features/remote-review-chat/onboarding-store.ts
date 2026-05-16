import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";

const REMOTE_REVIEW_CHAT_ONBOARDING_STORAGE_KEY =
  "rudu-remote-review-chat-onboarding";

type RemoteReviewChatOnboardingState = {
  hasSentFirstMessage: boolean;
  markFirstMessageSent(): void;
};

type RemoteReviewChatOnboardingPersistedState = Pick<
  RemoteReviewChatOnboardingState,
  "hasSentFirstMessage"
>;

const REMOTE_REVIEW_CHAT_ONBOARDING_INITIAL_STATE = {
  hasSentFirstMessage: false,
} satisfies Pick<RemoteReviewChatOnboardingState, "hasSentFirstMessage">;

function createRemoteReviewChatOnboardingState() {
  return {
    ...REMOTE_REVIEW_CHAT_ONBOARDING_INITIAL_STATE,
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
        markFirstMessageSent: () => set({ hasSentFirstMessage: true }),
      }),
      {
        name: REMOTE_REVIEW_CHAT_ONBOARDING_STORAGE_KEY,
        storage,
        partialize: (state) => ({
          hasSentFirstMessage: state.hasSentFirstMessage,
        }),
      },
    ),
  );
}

function createMemoryStorage(
  initial: Record<string, string> = {},
): StateStorage {
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
