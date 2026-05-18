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
  const draftTarget = useReviewComposerStore((s) => s.draftTarget);
  const activeComposerKey = useReviewComposerStore((s) => s.activeComposerKey);
  const pendingComposerState = useReviewComposerStore(
    (s) => s.pendingComposerState,
  );

  const actions = useReviewComposerStore((s) => s.actions);
  const { createComment, replyToComment, updateComment } = reviewComments;
  const viewerLogin = reviewComments.viewerLogin;

  useEffect(() => {
    actions.reset();
  }, [selectedDiffKey]);

  function getDraftComposerState(
    target: DraftReviewCommentTarget | null,
  ): ComposerBufferState {
    return useReviewComposerStore.getState().getDraftComposerState(target);
  }

  function getReplyComposerState(thread: ReviewThread): ComposerBufferState {
    return useReviewComposerStore.getState().getReplyComposerState(thread);
  }

  function getEditComposerState(comment: ReviewComment): ComposerBufferState {
    return useReviewComposerStore.getState().getEditComposerState(comment);
  }

  function openLineCommentDraft(
    path: string,
    range: Parameters<typeof actions.openLineCommentDraft>[1],
  ) {
    actions.openLineCommentDraft(path, range);
  }

  async function submitDraftComment(body: string) {
    const currentDraftTarget = useReviewComposerStore.getState().draftTarget;
    if (!selectedPatch || !currentDraftTarget) {
      return;
    }

    const submitTarget = {
      draftTarget: currentDraftTarget,
      key: getDraftComposerKey(currentDraftTarget),
      mode: "draft" as const,
    };

    actions.beginSubmit(submitTarget, body);

    try {
      await createComment({
        repo: selectedPatch.repo,
        number: selectedPatch.number,
        body,
        path: currentDraftTarget.path,
        line: currentDraftTarget.type === "line" ? currentDraftTarget.line : null,
        side: currentDraftTarget.type === "line" ? currentDraftTarget.side : null,
        startLine:
          currentDraftTarget.type === "line" ? currentDraftTarget.startLine : null,
        startSide:
          currentDraftTarget.type === "line" ? currentDraftTarget.startSide : null,
        subjectType: currentDraftTarget.type === "file" ? "file" : "line",
      });
      actions.completeSubmitSuccess(submitTarget.key);
    } catch (error) {
      actions.restoreSubmitFailure(
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
      actions.restoreSubmitFailure(
        submitTarget,
        body,
        "This thread cannot be replied to from the app.",
      );
      return;
    }

    actions.beginSubmit(submitTarget, body);

    try {
      await replyToComment({
        threadId: thread.id,
        body,
      });
      actions.completeSubmitSuccess(submitTarget.key);
    } catch (error) {
      actions.restoreSubmitFailure(
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
      actions.restoreSubmitFailure(
        submitTarget,
        body,
        "This comment cannot be edited from the app.",
      );
      return;
    }

    actions.beginSubmit(submitTarget, body);

    try {
      await updateComment({
        commentId: comment.id,
        body,
      });
      actions.completeSubmitSuccess(submitTarget.key);
    } catch (error) {
      actions.restoreSubmitFailure(
        submitTarget,
        body,
        getErrorMessage(error),
      );
    }
  }

  return {
    activeComposerKey,
    draftCommentTarget: draftTarget,
    getDraftComposerState,
    getEditComposerState,
    getReplyComposerState,
    pendingComposerState,
    viewerLogin,
    actions: {
      applyPendingComposerState() {
        actions.applyPendingComposerState();
      },
      cancelDraftComment() {
        actions.cancelDraftComment();
      },
      closeActiveComposer() {
        actions.closeActiveComposer();
      },
      dismissPendingComposerState() {
        actions.dismissPendingComposerState();
      },
      editComment,
      openLineCommentDraft,
      replyToThread,
      requestEditComposer(comment: ReviewComment) {
        actions.requestEditComposer(comment);
      },
      requestReplyComposer(thread: ReviewThread) {
        actions.requestReplyComposer(thread);
      },
      setActiveComposerDirty(isDirty: boolean) {
        actions.setActiveComposerDirty(isDirty);
      },
      submitDraftComment,
    },
  };
}

export { usePatchReviewComposerSession };
export type { DraftReviewCommentTarget, PatchReviewCommentApi };
