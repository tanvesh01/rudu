import { useEffect, useState } from "react";
import type {
  CreatePullRequestReviewCommentInput,
  ReplyToPullRequestReviewCommentInput,
  UpdatePullRequestReviewCommentInput,
} from "../../types/github";
import type { ReviewComment, ReviewThread } from "../../lib/review-threads";
import {
  applyPendingComposerState,
  beginComposerSubmit,
  closeActiveComposer,
  completeComposerSubmitSuccess,
  createComposerBufferState,
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
  const [composerState, setComposerState] = useState(
    createInitialReviewComposerSessionState,
  );
  const { createComment, replyToComment, updateComment } = reviewComments;
  const viewerLogin = reviewComments.viewerLogin;

  useEffect(() => {
    setComposerState(resetReviewComposerSessionState());
  }, [selectedDiffKey]);

  function getDraftComposerState(
    target: DraftReviewCommentTarget | null,
  ): ComposerBufferState {
    return getComposerBufferState(
      composerState,
      target ? getDraftComposerKey(target) : null,
      "draft",
    );
  }

  function getReplyComposerState(thread: ReviewThread): ComposerBufferState {
    return getComposerBufferState(
      composerState,
      getReplyComposerKey(thread),
      "reply",
    );
  }

  function getEditComposerState(comment: ReviewComment): ComposerBufferState {
    const composerKey = getEditComposerKey(comment);
    return (
      composerState.composerBuffers[composerKey] ??
      createComposerBufferState("edit", {
        initialValue: comment.body,
      })
    );
  }

  function openLineCommentDraft(path: string, range: Parameters<typeof createLineDraftTarget>[1]) {
    const nextTarget = createLineDraftTarget(path, range);
    if (!nextTarget) {
      return;
    }

    setComposerState((current) => requestFreshDraftComposer(current, nextTarget));
  }

  async function submitDraftComment(body: string) {
    if (!selectedPatch || !composerState.draftTarget) {
      return;
    }

    const submittedTarget = composerState.draftTarget;
    const submitTarget = {
      draftTarget: submittedTarget,
      key: getDraftComposerKey(submittedTarget),
      mode: "draft" as const,
    };

    setComposerState((current) =>
      beginComposerSubmit(current, submitTarget, body),
    );

    try {
      await createComment({
        repo: selectedPatch.repo,
        number: selectedPatch.number,
        body,
        path: submittedTarget.path,
        line: submittedTarget.type === "line" ? submittedTarget.line : null,
        side: submittedTarget.type === "line" ? submittedTarget.side : null,
        startLine:
          submittedTarget.type === "line" ? submittedTarget.startLine : null,
        startSide:
          submittedTarget.type === "line" ? submittedTarget.startSide : null,
        subjectType: submittedTarget.type === "file" ? "file" : "line",
      });
      setComposerState((current) =>
        completeComposerSubmitSuccess(current, submitTarget.key),
      );
    } catch (error) {
      setComposerState((current) =>
        restoreComposerSubmitFailure(
          current,
          submitTarget,
          body,
          getErrorMessage(error),
        ),
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
      setComposerState((current) =>
        restoreComposerSubmitFailure(
          current,
          submitTarget,
          body,
          "This thread cannot be replied to from the app.",
        ),
      );
      return;
    }

    setComposerState((current) =>
      beginComposerSubmit(current, submitTarget, body),
    );

    try {
      await replyToComment({
        threadId: thread.id,
        body,
      });
      setComposerState((current) =>
        completeComposerSubmitSuccess(current, submitTarget.key),
      );
    } catch (error) {
      setComposerState((current) =>
        restoreComposerSubmitFailure(
          current,
          submitTarget,
          body,
          getErrorMessage(error),
        ),
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
      setComposerState((current) =>
        restoreComposerSubmitFailure(
          current,
          submitTarget,
          body,
          "This comment cannot be edited from the app.",
        ),
      );
      return;
    }

    setComposerState((current) =>
      beginComposerSubmit(current, submitTarget, body),
    );

    try {
      await updateComment({
        commentId: comment.id,
        body,
      });
      setComposerState((current) =>
        completeComposerSubmitSuccess(current, submitTarget.key),
      );
    } catch (error) {
      setComposerState((current) =>
        restoreComposerSubmitFailure(
          current,
          submitTarget,
          body,
          getErrorMessage(error),
        ),
      );
    }
  }

  return {
    activeComposerKey: composerState.activeComposerKey,
    draftCommentTarget: composerState.draftTarget,
    getDraftComposerState,
    getEditComposerState,
    getReplyComposerState,
    pendingComposerState: composerState.pendingComposerState,
    viewerLogin,
    actions: {
      applyPendingComposerState() {
        setComposerState((current) => applyPendingComposerState(current));
      },
      cancelDraftComment() {
        setComposerState((current) => closeActiveComposer(current));
      },
      closeActiveComposer() {
        setComposerState((current) => closeActiveComposer(current));
      },
      dismissPendingComposerState() {
        setComposerState((current) => dismissPendingComposerState(current));
      },
      editComment,
      openLineCommentDraft,
      replyToThread,
      requestEditComposer(comment: ReviewComment) {
        setComposerState((current) => requestFreshEditComposer(current, comment));
      },
      requestReplyComposer(thread: ReviewThread) {
        setComposerState((current) =>
          requestFreshReplyComposer(current, thread),
        );
      },
      setActiveComposerDirty(isDirty: boolean) {
        setComposerState((current) =>
          setActiveComposerDirty(current, isDirty),
        );
      },
      submitDraftComment,
    },
  };
}

export { usePatchReviewComposerSession };
export type { DraftReviewCommentTarget, PatchReviewCommentApi };
