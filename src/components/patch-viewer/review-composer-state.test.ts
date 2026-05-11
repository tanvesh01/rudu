import { describe, expect, it } from "bun:test";
import type { ReviewComment, ReviewThread } from "../../lib/review-threads";
import {
  applyPendingComposerState,
  beginComposerSubmit,
  completeComposerSubmitSuccess,
  createInitialReviewComposerSessionState,
  createLineDraftTarget,
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
  type DraftReviewCommentTarget,
} from "./review-composer-state";

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: "comment-1",
    databaseId: 1,
    authorLogin: "octocat",
    authorAvatarUrl: null,
    authorAssociation: "MEMBER",
    body: "Please adjust this.",
    createdAt: "2026-05-11T00:00:00Z",
    updatedAt: "2026-05-11T00:00:00Z",
    url: "https://github.com/outerworld/rudu/pull/1#discussion_r1",
    replyToId: null,
    ...overrides,
  };
}

function makeThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "thread-1",
    path: "src/app.ts",
    isResolved: false,
    isOutdated: false,
    line: 2,
    startLine: null,
    side: "RIGHT",
    startSide: null,
    subjectType: "line",
    comments: [makeComment()],
    ...overrides,
  };
}

describe("review composer state", () => {
  it("blocks switching away from a dirty composer and stores the pending target", () => {
    const thread = makeThread();
    const comment = makeComment({ id: "comment-2" });

    const initialState = requestFreshReplyComposer(
      createInitialReviewComposerSessionState(),
      thread,
    );
    const dirtyState = setActiveComposerDirty(initialState, true);
    const nextState = requestFreshEditComposer(dirtyState, comment);

    expect(nextState.activeComposerKey).toBe(getReplyComposerKey(thread));
    expect(nextState.pendingComposerState).toEqual({
      activeComposerKey: getEditComposerKey(comment),
      draftTarget: null,
    });
  });

  it("applies the pending target after discard confirmation", () => {
    const thread = makeThread();
    const comment = makeComment({ id: "comment-2" });

    const replyState = requestFreshReplyComposer(
      createInitialReviewComposerSessionState(),
      thread,
    );
    const dirtyState = setActiveComposerDirty(replyState, true);
    const blockedState = requestFreshEditComposer(dirtyState, comment);
    const confirmedState = applyPendingComposerState(blockedState);

    expect(confirmedState.activeComposerKey).toBe(getEditComposerKey(comment));
    expect(confirmedState.pendingComposerState).toBeNull();
    expect(confirmedState.isActiveComposerDirty).toBe(false);
  });

  it("treats opening the same target as a no-op when there is no buffered state", () => {
    const thread = makeThread();
    const initialState = requestFreshReplyComposer(
      createInitialReviewComposerSessionState(),
      thread,
    );

    expect(requestFreshReplyComposer(initialState, thread)).toBe(initialState);
  });

  it("normalizes selected line ranges into GitHub draft targets", () => {
    const draftTarget = createLineDraftTarget("src/app.ts", {
      start: 12,
      side: "deletions",
      end: 9,
      endSide: "additions",
    });

    expect(draftTarget).toEqual({
      type: "line",
      path: "src/app.ts",
      line: 12,
      side: "LEFT",
      startLine: 9,
      startSide: "RIGHT",
    });
  });

  it("clears buffered submit state after successful draft, reply, and edit submits", () => {
    const draftTarget: DraftReviewCommentTarget = {
      type: "file",
      path: "src/app.ts",
    };
    const thread = makeThread();
    const comment = thread.comments[0];

    const draftSubmitState = completeComposerSubmitSuccess(
      beginComposerSubmit(
        requestFreshDraftComposer(
          createInitialReviewComposerSessionState(),
          draftTarget,
        ),
        {
          draftTarget,
          key: getDraftComposerKey(draftTarget),
          mode: "draft",
        },
        "Draft body",
      ),
      getDraftComposerKey(draftTarget),
    );
    const replySubmitState = completeComposerSubmitSuccess(
      beginComposerSubmit(
        requestFreshReplyComposer(
          createInitialReviewComposerSessionState(),
          thread,
        ),
        {
          draftTarget: null,
          key: getReplyComposerKey(thread),
          mode: "reply",
        },
        "Reply body",
      ),
      getReplyComposerKey(thread),
    );
    const editSubmitState = completeComposerSubmitSuccess(
      beginComposerSubmit(
        requestFreshEditComposer(
          createInitialReviewComposerSessionState(),
          comment,
        ),
        {
          draftTarget: null,
          key: getEditComposerKey(comment),
          mode: "edit",
        },
        "Edited body",
      ),
      getEditComposerKey(comment),
    );

    expect(
      getComposerBufferState(
        draftSubmitState,
        getDraftComposerKey(draftTarget),
        "draft",
      ).isPending,
    ).toBe(false);
    expect(
      getComposerBufferState(
        replySubmitState,
        getReplyComposerKey(thread),
        "reply",
      ).isPending,
    ).toBe(false);
    expect(
      getComposerBufferState(
        editSubmitState,
        getEditComposerKey(comment),
        "edit",
      ).isPending,
    ).toBe(false);
  });

  it("restores draft submit failures on the same draft target", () => {
    const draftTarget: DraftReviewCommentTarget = {
      type: "line",
      path: "src/app.ts",
      line: 5,
      side: "RIGHT",
      startLine: null,
      startSide: null,
    };
    const submitTarget = {
      draftTarget,
      key: getDraftComposerKey(draftTarget),
      mode: "draft" as const,
    };

    const failedState = restoreComposerSubmitFailure(
      beginComposerSubmit(
        requestFreshDraftComposer(
          createInitialReviewComposerSessionState(),
          draftTarget,
        ),
        submitTarget,
        "Draft body",
      ),
      submitTarget,
      "Draft body",
      "Draft failed",
    );
    const draftComposerState = getComposerBufferState(
      failedState,
      submitTarget.key,
      "draft",
    );

    expect(failedState.activeComposerKey).toBe(submitTarget.key);
    expect(failedState.draftTarget).toEqual(draftTarget);
    expect(draftComposerState.initialValue).toBe("Draft body");
    expect(draftComposerState.error).toBe("Draft failed");
    expect(draftComposerState.isPending).toBe(false);
  });

  it("restores reply and edit failures with the typed body and reopened composer", () => {
    const thread = makeThread();
    const comment = thread.comments[0];
    const replySubmitTarget = {
      draftTarget: null,
      key: getReplyComposerKey(thread),
      mode: "reply" as const,
    };
    const editSubmitTarget = {
      draftTarget: null,
      key: getEditComposerKey(comment),
      mode: "edit" as const,
    };

    const failedReplyState = restoreComposerSubmitFailure(
      beginComposerSubmit(
        requestFreshReplyComposer(
          createInitialReviewComposerSessionState(),
          thread,
        ),
        replySubmitTarget,
        "Reply body",
      ),
      replySubmitTarget,
      "Reply body",
      "Reply failed",
    );
    const failedEditState = restoreComposerSubmitFailure(
      beginComposerSubmit(
        requestFreshEditComposer(
          createInitialReviewComposerSessionState(),
          comment,
        ),
        editSubmitTarget,
        "Edited body",
      ),
      editSubmitTarget,
      "Edited body",
      "Edit failed",
    );

    expect(failedReplyState.activeComposerKey).toBe(replySubmitTarget.key);
    expect(
      getComposerBufferState(
        failedReplyState,
        replySubmitTarget.key,
        "reply",
      ),
    ).toMatchObject({
      initialValue: "Reply body",
      error: "Reply failed",
      isPending: false,
    });

    expect(failedEditState.activeComposerKey).toBe(editSubmitTarget.key);
    expect(
      getComposerBufferState(
        failedEditState,
        editSubmitTarget.key,
        "edit",
      ),
    ).toMatchObject({
      initialValue: "Edited body",
      error: "Edit failed",
      isPending: false,
    });
  });

  it("resets ephemeral composer state cleanly", () => {
    const thread = makeThread();
    const dirtyState = setActiveComposerDirty(
      requestFreshReplyComposer(
        createInitialReviewComposerSessionState(),
        thread,
      ),
      true,
    );
    const resetState = resetReviewComposerSessionState();

    expect(resetState).toEqual(createInitialReviewComposerSessionState());
    expect(resetState).not.toBe(dirtyState);
  });
});
