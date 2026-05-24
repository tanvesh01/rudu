import type { SelectedLineRange } from "@pierre/diffs";
import {
  normalizePath,
  type ReviewComment,
  type ReviewThread,
} from "../../lib/review-threads";
import type { ReviewCommentSide } from "../../types/github";

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

type ComposerMode = "draft" | "reply" | "edit";

type ComposerBufferState = {
  mode: ComposerMode;
  initialValue: string;
  error: string;
  isPending: boolean;
};

type ComposerViewState = {
  activeComposerKey: string | null;
  draftTarget: DraftReviewCommentTarget | null;
};

type ReviewComposerSessionState = {
  activeComposerKey: string | null;
  composerBuffers: Record<string, ComposerBufferState>;
  draftTarget: DraftReviewCommentTarget | null;
  isActiveComposerDirty: boolean;
  pendingComposerState: ComposerViewState | null;
};

type ComposerSubmitTarget = {
  draftTarget: DraftReviewCommentTarget | null;
  key: string;
  mode: ComposerMode;
};

function toGithubSide(side: SelectedLineRange["side"]): ReviewCommentSide {
  return side === "deletions" ? "LEFT" : "RIGHT";
}

function createLineDraftTarget(path: string, range: SelectedLineRange) {
  const startSide = range.side ?? range.endSide;
  const endSide = range.endSide ?? range.side;
  if (!startSide || !endSide) {
    return null;
  }

  const startsFirst = range.start <= range.end;
  const startLine = startsFirst ? range.start : range.end;
  const startGithubSide = toGithubSide(startsFirst ? startSide : endSide);
  const endLine = startsFirst ? range.end : range.start;
  const endGithubSide = toGithubSide(startsFirst ? endSide : startSide);

  return {
    type: "line",
    path,
    line: endLine,
    side: endGithubSide,
    startLine: startLine !== endLine ? startLine : null,
    startSide: startLine !== endLine ? startGithubSide : null,
  } satisfies DraftReviewCommentTarget;
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

function createComposerBufferState(
  mode: ComposerMode,
  overrides: Partial<Omit<ComposerBufferState, "mode">> = {},
): ComposerBufferState {
  return {
    mode,
    initialValue: "",
    error: "",
    isPending: false,
    ...overrides,
  };
}

function createInitialReviewComposerSessionState(): ReviewComposerSessionState {
  return {
    activeComposerKey: null,
    composerBuffers: {},
    draftTarget: null,
    isActiveComposerDirty: false,
    pendingComposerState: null,
  };
}

function clearComposerBuffer(
  state: ReviewComposerSessionState,
  composerKey: string | null,
) {
  if (!composerKey || !(composerKey in state.composerBuffers)) {
    return state;
  }

  const nextBuffers = { ...state.composerBuffers };
  delete nextBuffers[composerKey];

  return {
    ...state,
    composerBuffers: nextBuffers,
  };
}

function setComposerBuffer(
  state: ReviewComposerSessionState,
  composerKey: string,
  bufferState: ComposerBufferState,
) {
  return {
    ...state,
    composerBuffers: {
      ...state.composerBuffers,
      [composerKey]: bufferState,
    },
  };
}

function applyComposerViewState(
  state: ReviewComposerSessionState,
  nextState: ComposerViewState,
) {
  return {
    ...state,
    activeComposerKey: nextState.activeComposerKey,
    draftTarget: nextState.draftTarget,
    isActiveComposerDirty: false,
    pendingComposerState: null,
  };
}

function requestComposerViewState(
  state: ReviewComposerSessionState,
  nextState: ComposerViewState,
) {
  const nextDraftKey = nextState.draftTarget
    ? getDraftComposerKey(nextState.draftTarget)
    : null;
  const currentDraftKey = state.draftTarget
    ? getDraftComposerKey(state.draftTarget)
    : null;

  if (
    state.activeComposerKey === nextState.activeComposerKey &&
    nextDraftKey === currentDraftKey
  ) {
    return state;
  }

  if (state.activeComposerKey !== null && state.isActiveComposerDirty) {
    return {
      ...state,
      pendingComposerState: nextState,
    };
  }

  return applyComposerViewState(state, nextState);
}

function requestFreshDraftComposer(
  state: ReviewComposerSessionState,
  target: DraftReviewCommentTarget,
) {
  const composerKey = getDraftComposerKey(target);
  return requestComposerViewState(clearComposerBuffer(state, composerKey), {
    activeComposerKey: composerKey,
    draftTarget: target,
  });
}

function requestFreshReplyComposer(
  state: ReviewComposerSessionState,
  thread: ReviewThread,
) {
  const composerKey = getReplyComposerKey(thread);
  return requestComposerViewState(clearComposerBuffer(state, composerKey), {
    activeComposerKey: composerKey,
    draftTarget: null,
  });
}

function requestFreshEditComposer(
  state: ReviewComposerSessionState,
  comment: ReviewComment,
) {
  const composerKey = getEditComposerKey(comment);
  return requestComposerViewState(clearComposerBuffer(state, composerKey), {
    activeComposerKey: composerKey,
    draftTarget: null,
  });
}

function closeActiveComposer(state: ReviewComposerSessionState) {
  return applyComposerViewState(
    clearComposerBuffer(state, state.activeComposerKey),
    {
      activeComposerKey: null,
      draftTarget: null,
    },
  );
}

function setActiveComposerDirty(
  state: ReviewComposerSessionState,
  isDirty: boolean,
) {
  return {
    ...state,
    isActiveComposerDirty: isDirty,
  };
}

function dismissPendingComposerState(state: ReviewComposerSessionState) {
  if (!state.pendingComposerState) {
    return state;
  }

  return {
    ...state,
    pendingComposerState: null,
  };
}

function applyPendingComposerState(state: ReviewComposerSessionState) {
  if (!state.pendingComposerState) {
    return state;
  }

  return applyComposerViewState(
    clearComposerBuffer(state, state.activeComposerKey),
    state.pendingComposerState,
  );
}

function beginComposerSubmit(
  state: ReviewComposerSessionState,
  submitTarget: ComposerSubmitTarget,
  body: string,
) {
  return setComposerBuffer(
    applyComposerViewState(state, {
      activeComposerKey: null,
      draftTarget: null,
    }),
    submitTarget.key,
    createComposerBufferState(submitTarget.mode, {
      initialValue: body,
      isPending: true,
    }),
  );
}

function completeComposerSubmitSuccess(
  state: ReviewComposerSessionState,
  composerKey: string,
) {
  return clearComposerBuffer(state, composerKey);
}

function restoreComposerSubmitFailure(
  state: ReviewComposerSessionState,
  submitTarget: ComposerSubmitTarget,
  body: string,
  error: string,
) {
  return setComposerBuffer(
    applyComposerViewState(state, {
      activeComposerKey: submitTarget.key,
      draftTarget: submitTarget.draftTarget,
    }),
    submitTarget.key,
    createComposerBufferState(submitTarget.mode, {
      error,
      initialValue: body,
      isPending: false,
    }),
  );
}

function getComposerBufferState(
  state: ReviewComposerSessionState,
  composerKey: string | null,
  mode: ComposerMode,
  overrides?: Partial<Omit<ComposerBufferState, "mode">>,
) {
  if (!composerKey) {
    return createComposerBufferState(mode, overrides);
  }

  return state.composerBuffers[composerKey] ?? createComposerBufferState(mode, overrides);
}

export {
  applyPendingComposerState,
  beginComposerSubmit,
  closeActiveComposer,
  completeComposerSubmitSuccess,
  createInitialReviewComposerSessionState,
  createLineDraftTarget,
  createComposerBufferState,
  dismissPendingComposerState,
  getComposerBufferState,
  getDraftComposerKey,
  getEditComposerKey,
  getReplyComposerKey,
  getSelectedLineLabel,
  getThreadRefKey,
  requestFreshDraftComposer,
  requestFreshEditComposer,
  requestFreshReplyComposer,
  resetReviewComposerSessionState,
  restoreComposerSubmitFailure,
  setActiveComposerDirty,
};
export type {
  ComposerBufferState,
  ComposerMode,
  ComposerSubmitTarget,
  ComposerViewState,
  DraftReviewCommentTarget,
  ReviewComposerSessionState,
};

function resetReviewComposerSessionState() {
  return createInitialReviewComposerSessionState();
}
