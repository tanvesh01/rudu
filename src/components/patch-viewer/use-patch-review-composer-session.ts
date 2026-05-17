import { useEffect } from "react";
import type {
  CreatePullRequestReviewCommentInput,
  ReplyToPullRequestReviewCommentInput,
  UpdatePullRequestReviewCommentInput,
} from "../../types/github";
import type { ReviewComment, ReviewThread } from "../../lib/review-threads";
import { useReviewComposerStore } from "../../stores";
import {
  getDraftComposerKey,
  getReplyComposerKey,
  getEditComposerKey,
  type ComposerBufferState,
  type DraftReviewCommentTarget,
} from "./review-composer-state";

type SelectedPatchForComposer = {
  repo: string;
  number: number;
  headSha: string;
};

type UsePatchReviewComposerSessionArgs = {
  reviewComments: PatchReviewCommentApi;
  selectedDiffKey: string | null;
  selectedPatch: SelectedPatchForComposer | null;
};

type PatchReviewCommentApi = {
  createComment: (input: CreatePullRequestReviewCommentInput) => Promise<void>;
  isCreateCommentPending: boolean;
  replyToComment: (
    input: ReplyToPullRequestReviewCommentInput,
  ) => Promise<void>;
  updateComment: (
    input: UpdatePullRequestReviewCommentInput,
  ) => Promise<void>;
  viewerLogin: string | null;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function usePatchReviewComposerSession({
  reviewComments,
  selectedDiffKey,
  selectedPatch,
}: UsePatchReviewComposerSessionArgs) {
  const store = useReviewComposerStore();
  const { createComment, replyToComment, updateComment } = reviewComments;
  const viewerLogin = reviewComments.viewerLogin;

  useEffect(() => {
    store.reset();
  }, [selectedDiffKey, store]);

  function getDraftComposerState(
    target: DraftReviewCommentTarget | null,
  ): ComposerBufferState {
    return store.getDraftComposerState(target);
  }

  function getReplyComposerState(thread: ReviewThread): ComposerBufferState {
    return store.getReplyComposerState(thread);
  }

  function getEditComposerState(comment: ReviewComment): ComposerBufferState {
    return store.getEditComposerState(comment);
  }

  function openLineCommentDraft(
    path: string,
    range: Parameters<typeof store.openLineCommentDraft>[1],
  ) {
    store.openLineCommentDraft(path, range);
  }

  async function submitDraftComment(body: string) {
    const draftTarget = store.draftTarget;
    if (!selectedPatch || !draftTarget) {
      return;
    }

    const submitTarget = {
      draftTarget,
      key: getDraftComposerKey(draftTarget),
      mode: "draft" as const,
    };

    store.beginSubmit(submitTarget, body);

    try {
      await createComment({
        repo: selectedPatch.repo,
        number: selectedPatch.number,
        body,
        path: draftTarget.path,
        line: draftTarget.type === "line" ? draftTarget.line : null,
        side: draftTarget.type === "line" ? draftTarget.side : null,
        startLine:
          draftTarget.type === "line" ? draftTarget.startLine : null,
        startSide:
          draftTarget.type === "line" ? draftTarget.startSide : null,
        subjectType: draftTarget.type === "file" ? "file" : "line",
      });
      store.completeSubmitSuccess(submitTarget.key);
    } catch (error) {
      store.restoreSubmitFailure(
        submitTarget,
        body,
        getErrorMessage(error),
      );
    }
  }

  async function replyToThread(thread: ReviewThread, body: string) {
    const submitTarget = {
      draftTarget: null,
      key: getReplyComposerKey(thread),
      mode: "reply" as const,
    };

    if (!thread.id) {
      store.restoreSubmitFailure(
        submitTarget,
        body,
        "This thread cannot be replied to from the app.",
      );
      return;
    }

    store.beginSubmit(submitTarget, body);

    try {
      await replyToComment({
        threadId: thread.id,
        body,
      });
      store.completeSubmitSuccess(submitTarget.key);
    } catch (error) {
      store.restoreSubmitFailure(
        submitTarget,
        body,
        getErrorMessage(error),
      );
    }
  }

  async function editComment(comment: ReviewComment, body: string) {
    const submitTarget = {
      draftTarget: null,
      key: getEditComposerKey(comment),
      mode: "edit" as const,
    };

    if (!comment.id) {
      store.restoreSubmitFailure(
        submitTarget,
        body,
        "This comment cannot be edited from the app.",
      );
      return;
    }

    store.beginSubmit(submitTarget, body);

    try {
      await updateComment({
        commentId: comment.id,
        body,
      });
      store.completeSubmitSuccess(submitTarget.key);
    } catch (error) {
      store.restoreSubmitFailure(
        submitTarget,
        body,
        getErrorMessage(error),
      );
    }
  }

  return {
    activeComposerKey: store.activeComposerKey,
    draftCommentTarget: store.draftTarget,
    getDraftComposerState,
    getEditComposerState,
    getReplyComposerState,
    pendingComposerState: store.pendingComposerState,
    viewerLogin,
    actions: {
      applyPendingComposerState() {
        store.applyPendingComposerState();
      },
      cancelDraftComment() {
        store.cancelDraftComment();
      },
      closeActiveComposer() {
        store.closeActiveComposer();
      },
      dismissPendingComposerState() {
        store.dismissPendingComposerState();
      },
      editComment,
      openLineCommentDraft,
      replyToThread,
      requestEditComposer(comment: ReviewComment) {
        store.requestEditComposer(comment);
      },
      requestReplyComposer(thread: ReviewThread) {
        store.requestReplyComposer(thread);
      },
      setActiveComposerDirty(isDirty: boolean) {
        store.setActiveComposerDirty(isDirty);
      },
      submitDraftComment,
    },
  };
}

export { usePatchReviewComposerSession };
export type { DraftReviewCommentTarget, PatchReviewCommentApi };
