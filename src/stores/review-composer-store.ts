import { create } from "zustand";
import type { SelectedLineRange } from "@pierre/diffs";
import type { ReviewComment, ReviewThread } from "../lib/review-threads";
import {
  applyPendingComposerState,
  beginComposerSubmit,
  closeActiveComposer,
  completeComposerSubmitSuccess,
  createInitialReviewComposerSessionState,
  createLineDraftTarget,
  dismissPendingComposerState,
  getComposerBufferState,
  getDraftComposerKey,
  getEditComposerKey,
  getReplyComposerKey,
  requestFreshDraftComposer,
  requestFreshEditComposer,
  requestFreshReplyComposer,
  resetReviewComposerSessionState,
  restoreComposerSubmitFailure,
  setActiveComposerDirty,
  type ComposerBufferState,
  type ComposerSubmitTarget,
  type DraftReviewCommentTarget,
  type ReviewComposerSessionState,
} from "../components/patch-viewer/review-composer-state";

interface ReviewComposerStore extends ReviewComposerSessionState {
  // Selectors
  getDraftComposerState: (
    target: DraftReviewCommentTarget | null,
  ) => ComposerBufferState;
  getReplyComposerState: (thread: ReviewThread) => ComposerBufferState;
  getEditComposerState: (comment: ReviewComment) => ComposerBufferState;

  // Actions — nested for stable subscription
  actions: {
    openLineCommentDraft: (
      path: string,
      range: SelectedLineRange,
    ) => void;
    requestReplyComposer: (thread: ReviewThread) => void;
    requestEditComposer: (comment: ReviewComment) => void;
    closeActiveComposer: () => void;
    cancelDraftComment: () => void;
    setActiveComposerDirty: (isDirty: boolean) => void;
    dismissPendingComposerState: () => void;
    applyPendingComposerState: () => void;
    beginSubmit: (submitTarget: ComposerSubmitTarget, body: string) => void;
    completeSubmitSuccess: (key: string) => void;
    restoreSubmitFailure: (
      submitTarget: ComposerSubmitTarget,
      body: string,
      error: string,
    ) => void;
    reset: () => void;
  };
}

const useReviewComposerStore = create<ReviewComposerStore>((set, get) => ({
  ...createInitialReviewComposerSessionState(),

  getDraftComposerState(target) {
    const state = get();
    return getComposerBufferState(
      state,
      target ? getDraftComposerKey(target) : null,
      "draft",
    );
  },

  getReplyComposerState(thread) {
    const state = get();
    return getComposerBufferState(state, getReplyComposerKey(thread), "reply");
  },

  getEditComposerState(comment) {
    const state = get();
    return getComposerBufferState(
      state,
      getEditComposerKey(comment),
      "edit",
      { initialValue: comment.body },
    );
  },

  actions: {
    openLineCommentDraft(path, range) {
      const nextTarget = createLineDraftTarget(path, range);
      if (!nextTarget) return;
      set((state) => requestFreshDraftComposer(state, nextTarget));
    },

    requestReplyComposer(thread) {
      set((state) => requestFreshReplyComposer(state, thread));
    },

    requestEditComposer(comment) {
      set((state) => requestFreshEditComposer(state, comment));
    },

    closeActiveComposer() {
      set((state) => closeActiveComposer(state));
    },

    cancelDraftComment() {
      set((state) => closeActiveComposer(state));
    },

    setActiveComposerDirty(isDirty) {
      set((state) => setActiveComposerDirty(state, isDirty));
    },

    dismissPendingComposerState() {
      set((state) => dismissPendingComposerState(state));
    },

    applyPendingComposerState() {
      set((state) => applyPendingComposerState(state));
    },

    beginSubmit(submitTarget, body) {
      set((state) => beginComposerSubmit(state, submitTarget, body));
    },

    completeSubmitSuccess(key) {
      set((state) => completeComposerSubmitSuccess(state, key));
    },

    restoreSubmitFailure(submitTarget, body, error) {
      set((state) => restoreComposerSubmitFailure(state, submitTarget, body, error));
    },

    reset() {
      set(createInitialReviewComposerSessionState());
    },
  },
}));

export { useReviewComposerStore };
export type { ReviewComposerStore };
