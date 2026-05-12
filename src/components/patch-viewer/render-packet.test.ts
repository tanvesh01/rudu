import { describe, expect, it } from "bun:test";
import { parsePatchFiles } from "@pierre/diffs";
import type { ReviewComment, ReviewThread } from "../../lib/review-threads";
import { createPatchViewModel } from "./patch-view-model";
import { createPatchFileRenderPacket } from "./render-packet";
import { buildFileDiffAnnotationSignature } from "./patch-file-diff-section";
import { createComposerBufferState } from "./review-composer-state";
import type { PatchFileRenderCallers } from "./render-packet";

const PATCH = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const n = 1;
+export const m = 2;
`;

function parseFileDiffs() {
  return parsePatchFiles(PATCH, "render-packet-test").flatMap(
    (parsedPatch) => parsedPatch.files,
  );
}

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

const NOOP = () => {};
const NOOP_ASYNC = async () => {};
const NOOP_RETURN = () => undefined;

const IDLE_CALLERS: PatchFileRenderCallers = {
  draftComposerState: createComposerBufferState("draft"),
  getEditComposerState: () => createComposerBufferState("edit"),
  getReplyComposerState: () => createComposerBufferState("reply"),
  getSuggestionSeedForThread: NOOP_RETURN,
  onActiveComposerDirtyChange: NOOP,
  onCancelDraftComment: NOOP,
  onCloseActiveComposer: NOOP,
  onEditComment: NOOP_ASYNC,
  onOpenLineCommentDraft: NOOP,
  onRegisterDiffNode: NOOP,
  onReplyToThread: NOOP_ASYNC,
  onRequestEditComposer: NOOP,
  onRequestReplyComposer: NOOP,
  onSubmitDraftComment: NOOP_ASYNC,
  renderReviewThreadAnnotations: () => null,
  viewerLogin: null,
};

describe("render packet", () => {
  it("bundles a view file and callers into a render packet", () => {
    const fileDiffs = parseFileDiffs();
    const viewModel = createPatchViewModel({
      activeComposerKey: null,
      draftCommentTarget: null,
      fileDiffs,
      lineStats: null,
      reviewThreads: [
        makeThread({ id: "thread-1", path: "src/app.ts" }),
      ],
    });

    const viewFile = viewModel.files[0];
    const packet = createPatchFileRenderPacket(viewFile, IDLE_CALLERS);

    expect(packet.fileDiff).toBe(viewFile.fileDiff);
    expect(packet.normalizedPath).toBe(viewFile.normalizedPath);
    expect(packet.fileReviewThreads).toBe(viewFile.fileReviewThreads);
    expect(packet.lineDraft).toBe(viewFile.lineDraft);
    expect(packet.fileDraft).toBe(viewFile.fileDraft);
    expect(packet.fileLevelActiveComposerKey).toBe(
      viewFile.fileLevelActiveComposerKey,
    );
    expect(packet.draftComposerState).toBe(IDLE_CALLERS.draftComposerState);
    expect(packet.getEditComposerState).toBe(IDLE_CALLERS.getEditComposerState);
    expect(packet.getReplyComposerState).toBe(
      IDLE_CALLERS.getReplyComposerState,
    );
    expect(packet.onRegisterDiffNode).toBe(IDLE_CALLERS.onRegisterDiffNode);
    expect(packet.renderReviewThreadAnnotations).toBe(
      IDLE_CALLERS.renderReviewThreadAnnotations,
    );
    expect(packet.viewerLogin).toBe(IDLE_CALLERS.viewerLogin);
  });

  it("pre-resolves the draft composer state for the active draft target per file", () => {
    const viewModel = createPatchViewModel({
      activeComposerKey: null,
      draftCommentTarget: {
        type: "file",
        path: "src/app.ts",
      },
      fileDiffs: parseFileDiffs(),
      lineStats: null,
      reviewThreads: [],
    });

    const viewFile = viewModel.files[0];
    const draftState = createComposerBufferState("draft", {
      initialValue: "draft body",
      isPending: true,
    });
    const callers = { ...IDLE_CALLERS, draftComposerState: draftState };
    const packet = createPatchFileRenderPacket(viewFile, callers);

    expect(packet.draftComposerState).toEqual(draftState);
    expect(packet.fileDraft).toEqual({
      type: "file",
      path: "src/app.ts",
    });
  });

  it("preserves per-file thread and draft identities from the view model", () => {
    const fileDiffs = parseFileDiffs();
    const reviewThreads = [
      makeThread({ id: "thread-app", path: "src/app.ts" }),
      makeThread({ id: "thread-new", path: "src/new.ts" }),
    ];

    const viewModel = createPatchViewModel({
      activeComposerKey: null,
      draftCommentTarget: null,
      fileDiffs,
      lineStats: null,
      reviewThreads,
    });

    const appPacket = createPatchFileRenderPacket(
      viewModel.files[0],
      IDLE_CALLERS,
    );
    const newPacket = createPatchFileRenderPacket(
      viewModel.files[1],
      IDLE_CALLERS,
    );

    expect(appPacket.fileDraft).toBeNull();
    expect(newPacket.fileDraft).toBeNull();
    expect(appPacket.lineDraft).toBeNull();
    expect(newPacket.lineDraft).toBeNull();
    expect(appPacket.fileReviewThreads.totalCount).toBe(1);
    expect(newPacket.fileReviewThreads.totalCount).toBe(1);
  });
});

describe("file diff annotation signature", () => {
  it("reflects comment identity and state changes", () => {
    const viewModel = createPatchViewModel({
      activeComposerKey: null,
      draftCommentTarget: null,
      fileDiffs: parseFileDiffs(),
      lineStats: null,
      reviewThreads: [
        makeThread({
          id: "thread-1",
          path: "src/app.ts",
          comments: [
            makeComment({ id: "comment-1", updatedAt: "2026-01-01T00:00:00Z" }),
          ],
        }),
      ],
    });

    const appFile = viewModel.files[0];
    const signatureA = buildFileDiffAnnotationSignature(
      appFile.fileReviewThreads,
    );

    const changedModel = createPatchViewModel({
      activeComposerKey: null,
      draftCommentTarget: null,
      fileDiffs: parseFileDiffs(),
      lineStats: null,
      reviewThreads: [
        makeThread({
          id: "thread-1",
          path: "src/app.ts",
          comments: [
            makeComment({ id: "comment-1", updatedAt: "2026-02-01T00:00:00Z" }),
          ],
        }),
      ],
    });

    const changedFile = changedModel.files[0];
    const signatureB = buildFileDiffAnnotationSignature(
      changedFile.fileReviewThreads,
    );

    expect(signatureA).not.toBe(signatureB);
  });

  it("reflects thread resolved state changes", () => {
    const resolvedModel = createPatchViewModel({
      activeComposerKey: null,
      draftCommentTarget: null,
      fileDiffs: parseFileDiffs(),
      lineStats: null,
      reviewThreads: [
        makeThread({
          id: "thread-1",
          isResolved: false,
          path: "src/app.ts",
        }),
      ],
    });
    const unresolvedModel = createPatchViewModel({
      activeComposerKey: null,
      draftCommentTarget: null,
      fileDiffs: parseFileDiffs(),
      lineStats: null,
      reviewThreads: [
        makeThread({
          id: "thread-1",
          isResolved: true,
          path: "src/app.ts",
        }),
      ],
    });

    const resolvedSig = buildFileDiffAnnotationSignature(
      resolvedModel.files[0].fileReviewThreads,
    );
    const unresolvedSig = buildFileDiffAnnotationSignature(
      unresolvedModel.files[0].fileReviewThreads,
    );

    expect(resolvedSig).not.toBe(unresolvedSig);
  });

  it("is stable when annotation data has not changed", () => {
    const viewModel = createPatchViewModel({
      activeComposerKey: null,
      draftCommentTarget: null,
      fileDiffs: parseFileDiffs(),
      lineStats: null,
      reviewThreads: [
        makeThread({
          id: "thread-1",
          path: "src/app.ts",
          comments: [
            makeComment({ id: "comment-1", updatedAt: "2026-01-01T00:00:00Z" }),
          ],
        }),
      ],
    });

    const appFile = viewModel.files[0];
    const signatureA = buildFileDiffAnnotationSignature(
      appFile.fileReviewThreads,
    );

    const sameModel = createPatchViewModel({
      activeComposerKey: null,
      draftCommentTarget: null,
      fileDiffs: parseFileDiffs(),
      lineStats: null,
      reviewThreads: [
        makeThread({
          id: "thread-1",
          path: "src/app.ts",
          comments: [
            makeComment({ id: "comment-1", updatedAt: "2026-01-01T00:00:00Z" }),
          ],
        }),
      ],
    });

    const signatureB = buildFileDiffAnnotationSignature(
      sameModel.files[0].fileReviewThreads,
    );

    expect(signatureA).toBe(signatureB);
  });
});
