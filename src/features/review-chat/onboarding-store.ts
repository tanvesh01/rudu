import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";

const REVIEW_CHAT_ONBOARDING_STORAGE_KEY =
  "rudu-review-chat-onboarding";

type ReviewChatOnboardingState = {
  hasSentFirstMessage: boolean;
  markFirstMessageSent(): void;
};

type ReviewChatOnboardingPersistedState = Pick<
  ReviewChatOnboardingState,
  "hasSentFirstMessage"
>;

const REVIEW_CHAT_ONBOARDING_INITIAL_STATE = {
  hasSentFirstMessage: false,
} satisfies Pick<ReviewChatOnboardingState, "hasSentFirstMessage">;

function createReviewChatOnboardingState() {
  return {
    ...REVIEW_CHAT_ONBOARDING_INITIAL_STATE,
    markFirstMessageSent: () => undefined,
  } satisfies ReviewChatOnboardingState;
}

function browserStorage() {
  return createJSONStorage<ReviewChatOnboardingPersistedState>(
    () => localStorage,
  );
}

function createReviewChatOnboardingStore(storage = browserStorage()) {
  return create<ReviewChatOnboardingState>()(
    persist(
      (set) => ({
        ...REVIEW_CHAT_ONBOARDING_INITIAL_STATE,
        markFirstMessageSent: () => set({ hasSentFirstMessage: true }),
      }),
      {
        name: REVIEW_CHAT_ONBOARDING_STORAGE_KEY,
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

const useReviewChatOnboardingStore =
  createReviewChatOnboardingStore();

export {
  createMemoryStorage,
  createReviewChatOnboardingState,
  createReviewChatOnboardingStore,
  REVIEW_CHAT_ONBOARDING_INITIAL_STATE,
  REVIEW_CHAT_ONBOARDING_STORAGE_KEY,
  useReviewChatOnboardingStore,
};
export type {
  ReviewChatOnboardingPersistedState,
  ReviewChatOnboardingState,
};
