import { useEffect, useState } from "react";
import type { SelectedLineRange } from "@pierre/diffs";
import { usePullRequestReviewCommentMutations } from "../../hooks/usePullRequestReviewCommentMutations";
import {
  normalizePath,
  type ReviewComment,
  type ReviewThread,
} from "../../lib/review-threads";
import type { ReviewCommentSide } from "../../types/github";

type SelectedPatchForComposer = {
  repo: string;
  number: number;
  headSha: string;
};

type DraftReviewCommentTarget =
  | {
      type: "file";
      path: string;
    }
  | {
      type: "line";
      path: string;
      line: number;
      side: ReviewCommentSide;
      startLine: number | null;
      startSide: ReviewCommentSide | null;
    };

type ComposerViewState = {
  activeComposerKey: string | null;
  draftTarget: DraftReviewCommentTarget | null;
};

type UsePatchReviewComposerSessionArgs = {
  selectedDiffKey: string | null;
  selectedPatch: SelectedPatchForComposer | null;
};

function toGithubSide(side: SelectedLineRange["side"]): ReviewCommentSide {
  return side === "deletions" ? "LEFT" : "RIGHT";
}

function getThreadRefKey(thread: ReviewThread) {
  if (thread.id) {
    return `id:${thread.id}`;
  }

  return `fallback:${normalizePath(thread.path)}:${thread.startLine ?? thread.line ?? "file"}:${thread.comments[0]?.id ?? "unknown"}`;
}

function getDraftComposerKey(target: DraftReviewCommentTarget) {
  if (target.type === "file") {
    return `draft:file:${normalizePath(target.path)}`;
  }

  return `draft:line:${normalizePath(target.path)}:${target.startLine ?? target.line}:${target.line}:${target.side}`;
}

function getReplyComposerKey(thread: ReviewThread) {
  return `reply:${getThreadRefKey(thread)}`;
}

function getEditComposerKey(comment: ReviewComment) {
  return `edit:${comment.id}`;
}

function getFileLevelActiveComposerKey(
  activeComposerKey: string | null,
  fileDraft: Extract<DraftReviewCommentTarget, { type: "file" }> | null,
  fileThreads: ReviewThread[],
) {
  if (!activeComposerKey) {
    return null;
  }

  if (fileDraft && activeComposerKey === getDraftComposerKey(fileDraft)) {
    return activeComposerKey;
  }

  if (activeComposerKey.startsWith("reply:")) {
    return fileThreads.some(
      (thread) => activeComposerKey === getReplyComposerKey(thread),
    )
      ? activeComposerKey
      : null;
  }

  if (activeComposerKey.startsWith("edit:")) {
    const commentId = activeComposerKey.slice("edit:".length);
    return fileThreads.some((thread) =>
      thread.comments.some((comment) => comment.id === commentId),
    )
      ? activeComposerKey
      : null;
  }

  return null;
}

function getSelectedLineLabel(target: DraftReviewCommentTarget | null) {
  if (!target || target.type !== "line") {
    return undefined;
  }

  const startLine = target.startLine ?? target.line;
  const endLine = target.line;

  if (startLine === endLine) {
    return `Line ${endLine}`;
  }

  return `Lines ${startLine}-${endLine}`;
}

function usePatchReviewComposerSession({
  selectedDiffKey,
  selectedPatch,
}: UsePatchReviewComposerSessionArgs) {
  const [draftCommentTarget, setDraftCommentTarget] =
    useState<DraftReviewCommentTarget | null>(null);
  const [activeComposerKey, setActiveComposerKey] = useState<string | null>(
    null,
  );
  const [isActiveComposerDirty, setIsActiveComposerDirty] = useState(false);
  const [pendingComposerState, setPendingComposerState] =
    useState<ComposerViewState | null>(null);
  const [draftCommentError, setDraftCommentError] = useState("");
  const [draftCommentInitialValue, setDraftCommentInitialValue] =
    useState("");
  const [restoredReplyBodies, setRestoredReplyBodies] = useState<
    Record<string, string>
  >({});
  const [restoredEditBodies, setRestoredEditBodies] = useState<
    Record<string, string>
  >({});
  const {
    createCommentMutation,
    replyCommentMutation,
    updateCommentMutation,
    viewerLogin,
  } = usePullRequestReviewCommentMutations(selectedPatch);

  useEffect(() => {
    setDraftCommentTarget(null);
    setActiveComposerKey(null);
    setIsActiveComposerDirty(false);
    setPendingComposerState(null);
    setDraftCommentError("");
    setDraftCommentInitialValue("");
    setRestoredReplyBodies({});
    setRestoredEditBodies({});
  }, [selectedDiffKey]);

  function applyComposerState(nextState: ComposerViewState) {
    setActiveComposerKey(nextState.activeComposerKey);
    setDraftCommentTarget(nextState.draftTarget);
    setIsActiveComposerDirty(false);
    setPendingComposerState(null);
    if (!nextState.draftTarget) {
      setDraftCommentInitialValue("");
    }
  }

  function requestComposerState(nextState: ComposerViewState) {
    const nextDraftKey = nextState.draftTarget
      ? getDraftComposerKey(nextState.draftTarget)
      : null;
    const currentDraftKey = draftCommentTarget
      ? getDraftComposerKey(draftCommentTarget)
      : null;

    if (
      activeComposerKey === nextState.activeComposerKey &&
      nextDraftKey === currentDraftKey
    ) {
      return;
    }

    if (activeComposerKey !== null && isActiveComposerDirty) {
      setPendingComposerState(nextState);
      return;
    }

    applyComposerState(nextState);
  }

  function closeActiveComposer() {
    requestComposerState({
      activeComposerKey: null,
      draftTarget: null,
    });
  }

  function cancelDraftComment() {
    setDraftCommentError("");
    setDraftCommentInitialValue("");
    closeActiveComposer();
  }

  function openLineCommentDraft(path: string, range: SelectedLineRange) {
    const startSide = range.side ?? range.endSide;
    const endSide = range.endSide ?? range.side;
    if (!startSide || !endSide) {
      return;
    }

    const startsFirst = range.start <= range.end;
    const startLine = startsFirst ? range.start : range.end;
    const startGithubSide = toGithubSide(startsFirst ? startSide : endSide);
    const endLine = startsFirst ? range.end : range.start;
    const endGithubSide = toGithubSide(startsFirst ? endSide : startSide);

    const nextDraftTarget: DraftReviewCommentTarget = {
      type: "line",
      path,
      line: endLine,
      side: endGithubSide,
      startLine: startLine !== endLine ? startLine : null,
      startSide: startLine !== endLine ? startGithubSide : null,
    };

    setDraftCommentError("");
    setDraftCommentInitialValue("");
    requestComposerState({
      activeComposerKey: getDraftComposerKey(nextDraftTarget),
      draftTarget: nextDraftTarget,
    });
  }

  async function submitDraftComment(body: string) {
    if (!selectedPatch || !draftCommentTarget) {
      return;
    }

    const submittedTarget = draftCommentTarget;
    setDraftCommentError("");
    setDraftCommentInitialValue("");
    applyComposerState({
      activeComposerKey: null,
      draftTarget: null,
    });

    try {
      await createCommentMutation.mutateAsync({
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
    } catch (error) {
      setDraftCommentError(
        error instanceof Error ? error.message : String(error),
      );
      setDraftCommentInitialValue(body);
      applyComposerState({
        activeComposerKey: getDraftComposerKey(submittedTarget),
        draftTarget: submittedTarget,
      });
    }
  }

  async function replyToThread(thread: ReviewThread, body: string) {
    if (!selectedPatch) {
      return;
    }

    if (!thread.id) {
      throw new Error("This thread cannot be replied to from the app.");
    }

    applyComposerState({
      activeComposerKey: null,
      draftTarget: null,
    });

    await replyCommentMutation.mutateAsync({
      threadId: thread.id,
      body,
    });
  }

  async function editComment(comment: ReviewComment, body: string) {
    if (!selectedPatch || !comment.id) {
      throw new Error("This comment cannot be edited from the app.");
    }

    applyComposerState({
      activeComposerKey: null,
      draftTarget: null,
    });

    await updateCommentMutation.mutateAsync({
      commentId: comment.id,
      body,
    });
  }

  function requestEditComposer(comment: ReviewComment) {
    requestComposerState({
      activeComposerKey: getEditComposerKey(comment),
      draftTarget: null,
    });
  }

  function requestReplyComposer(thread: ReviewThread) {
    requestComposerState({
      activeComposerKey: getReplyComposerKey(thread),
      draftTarget: null,
    });
  }

  function setRestoredReplyBody(threadId: string, body: string) {
    setRestoredReplyBodies((current) => {
      if (!body) {
        const next = { ...current };
        delete next[threadId];
        return next;
      }

      return {
        ...current,
        [threadId]: body,
      };
    });
  }

  function setRestoredEditBody(commentId: string, body: string | null) {
    setRestoredEditBodies((current) => {
      if (body === null) {
        const next = { ...current };
        delete next[commentId];
        return next;
      }

      return {
        ...current,
        [commentId]: body,
      };
    });
  }

  return {
    activeComposerKey,
    draftCommentError,
    draftCommentInitialValue,
    draftCommentTarget,
    isCreateCommentPending: createCommentMutation.isPending,
    pendingComposerState,
    restoredEditBodies,
    restoredReplyBodies,
    viewerLogin,
    actions: {
      applyPendingComposerState() {
        if (pendingComposerState) {
          applyComposerState(pendingComposerState);
        }
      },
      cancelDraftComment,
      clearDraftCommentError() {
        setDraftCommentError("");
      },
      closeActiveComposer,
      dismissPendingComposerState() {
        setPendingComposerState(null);
      },
      editComment,
      openLineCommentDraft,
      replyToThread,
      requestEditComposer,
      requestReplyComposer,
      setActiveComposerDirty: setIsActiveComposerDirty,
      setRestoredEditBody,
      setRestoredReplyBody,
      submitDraftComment,
    },
  };
}

export {
  getDraftComposerKey,
  getEditComposerKey,
  getFileLevelActiveComposerKey,
  getReplyComposerKey,
  getSelectedLineLabel,
  getThreadRefKey,
  usePatchReviewComposerSession,
};
export type { DraftReviewCommentTarget };
