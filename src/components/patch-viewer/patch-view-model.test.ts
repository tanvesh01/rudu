import { describe, expect, it } from "bun:test";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { buildReviewThreadsByFile, type ReviewComment, type ReviewThread } from "../../lib/review-threads";
import {
  createPatchViewModel,
  getPatchLineTotals,
} from "./patch-view-model";
import {
  getDraftComposerKey,
  getEditComposerKey,
  getReplyComposerKey,
  type DraftReviewCommentTarget,
} from "./review-composer-state";

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
diff --git a/src/deleted.ts b/src/deleted.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/deleted.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const old = 1;
-export const stale = 2;
`;

function parseFileDiffs() {
  return parsePatchFiles(PATCH, "patch-view-model-test").flatMap(
    (parsedPatch) => parsedPatch.files,
  );
}

function makeModel(
  overrides: Partial<
    Omit<Parameters<typeof createPatchViewModel>[0], "reviewThreadsByFile"> & {
      reviewThreads?: ReviewThread[];
    }
  > = {},
) {
  const { reviewThreads = [], ...rest } = overrides;
  return createPatchViewModel({
    activeComposerKey: null,
    draftCommentTarget: null,
    fileDiffs: parseFileDiffs(),
    lineStats: null,
    reviewThreadsByFile: buildReviewThreadsByFile(reviewThreads),
    ...rest,
  });
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

describe("patch view model", () => {
  it("prefers backend totals and falls back to parsed file stats", () => {
    const fileDiffs = parseFileDiffs();
    const fallbackStats = new Map(
      fileDiffs.map((fileDiff) => [
        fileDiff.name,
        {
          additions: fileDiff.additionLines.length,
          deletions: fileDiff.deletionLines.length,
          status: "modified" as const,
        },
      ]),
    );
    const fallbackTotals = {
      additions: fileDiffs.reduce(
        (total, fileDiff) => total + fileDiff.additionLines.length,
        0,
      ),
      deletions: fileDiffs.reduce(
        (total, fileDiff) => total + fileDiff.deletionLines.length,
        0,
      ),
    };

    expect(getPatchLineTotals({ additions: 99, deletions: 88 }, fallbackStats))
      .toEqual({ additions: 99, deletions: 88 });
    expect(getPatchLineTotals(null, fallbackStats)).toEqual(fallbackTotals);
    expect(makeModel({ lineStats: { additions: 7, deletions: 3 } }).totals)
      .toEqual({ additions: 7, deletions: 3 });
  });

  it("derives git status from parsed file change types", () => {
    const model = makeModel();

    expect(model.gitStatus).toEqual([
      { path: "src/app.ts", status: "modified" },
      { path: "src/new.ts", status: "added" },
      { path: "src/deleted.ts", status: "deleted" },
    ]);
  });

  it("matches review threads and draft targets by normalized path", () => {
    const lineDraft: DraftReviewCommentTarget = {
      type: "line",
      path: "b/src/app.ts",
      line: 2,
      side: "RIGHT",
      startLine: null,
      startSide: null,
    };
    const reviewThreads = [
      makeThread({ id: "thread-line", path: "b/src/app.ts" }),
      makeThread({
        id: "thread-file",
        path: "a/src/app.ts",
        line: null,
        side: null,
        subjectType: "file",
      }),
    ];
    const model = makeModel({
      draftCommentTarget: lineDraft,
      reviewThreads,
    });

    const appFile = model.files.find(
      (file) => file.normalizedPath === "src/app.ts",
    );

    expect(appFile?.lineDraft).toBe(lineDraft);
    expect(appFile?.fileDraft).toBeNull();
    expect(appFile?.fileReviewThreads.totalCount).toBe(2);
    expect(appFile?.fileReviewThreads.fileThreads).toHaveLength(1);
    expect(appFile?.fileReviewThreads.lineAnnotations).toHaveLength(1);
  });

  it("maps file-level active composer keys for draft, reply, and edit composers", () => {
    const fileDraft: DraftReviewCommentTarget = {
      type: "file",
      path: "src/app.ts",
    };
    const fileThread = makeThread({
      id: "thread-file",
      line: null,
      side: null,
      subjectType: "file",
      comments: [makeComment({ id: "comment-file" })],
    });

    const draftModel = makeModel({
      activeComposerKey: getDraftComposerKey(fileDraft),
      draftCommentTarget: fileDraft,
      reviewThreads: [fileThread],
    });
    const replyModel = makeModel({
      activeComposerKey: getReplyComposerKey(fileThread),
      reviewThreads: [fileThread],
    });
    const editModel = makeModel({
      activeComposerKey: getEditComposerKey(fileThread.comments[0]),
      reviewThreads: [fileThread],
    });

    expect(draftModel.files[0].fileLevelActiveComposerKey).toBe(
      getDraftComposerKey(fileDraft),
    );
    expect(replyModel.files[0].fileLevelActiveComposerKey).toBe(
      getReplyComposerKey(fileThread),
    );
    expect(editModel.files[0].fileLevelActiveComposerKey).toBe(
      getEditComposerKey(fileThread.comments[0]),
    );
  });

  it("returns suggestion seeds only for addition-only line ranges", () => {
    const model = makeModel();
    const additionDraft: DraftReviewCommentTarget = {
      type: "line",
      path: "src/app.ts",
      line: 3,
      side: "RIGHT",
      startLine: 2,
      startSide: "RIGHT",
    };
    const deletionDraft: DraftReviewCommentTarget = {
      type: "line",
      path: "src/app.ts",
      line: 2,
      side: "LEFT",
      startLine: null,
      startSide: null,
    };
    const additionThread = makeThread({
      path: "b/src/app.ts",
      line: 3,
      startLine: 2,
      side: "RIGHT",
      startSide: "RIGHT",
    });
    const deletionThread = makeThread({
      path: "src/app.ts",
      line: 2,
      side: "LEFT",
      startLine: null,
      startSide: null,
    });

    expect(model.getSuggestionSeedForDraftTarget(additionDraft)).toBe(
      "const b = 3;\n\nconst c = 4;\n",
    );
    expect(model.getSuggestionSeedForDraftTarget(deletionDraft)).toBeUndefined();
    expect(model.getSuggestionSeedForThread(additionThread)).toBe(
      "const b = 3;\n\nconst c = 4;\n",
    );
    expect(model.getSuggestionSeedForThread(deletionThread)).toBeUndefined();
  });

  it("builds normalized file lookup keys", () => {
    const fileDiff = {
      ...parseFileDiffs()[0],
      name: "b/src/app.ts",
    } satisfies FileDiffMetadata;
    const model = makeModel({ fileDiffs: [fileDiff] });

    expect(model.fileDiffByPath.get("src/app.ts")).toBe(fileDiff);
  });
});
