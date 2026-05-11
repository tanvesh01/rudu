import { useMemo } from "react";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { GitStatusEntry } from "@pierre/trees";
import { isAdditionOnlyReviewRange } from "../../lib/review-suggestions";
import {
  buildReviewThreadsByFile,
  getFileReviewThreadsForPath,
  normalizePath,
  type FileReviewThreads,
  type ReviewThread,
} from "../../lib/review-threads";
import type { FileStatsEntry } from "../../types/github";
import { getSuggestionSeedForLineRange } from "./review-suggestion-seeds";
import {
  getFileLevelActiveComposerKey,
  type DraftReviewCommentTarget,
} from "./review-composer-state";

type PatchLineTotals = {
  additions: number;
  deletions: number;
};

type PatchViewFile = {
  fileDiff: FileDiffMetadata;
  normalizedPath: string;
  fileReviewThreads: FileReviewThreads;
  lineDraft: Extract<DraftReviewCommentTarget, { type: "line" }> | null;
  fileDraft: Extract<DraftReviewCommentTarget, { type: "file" }> | null;
  fileLevelActiveComposerKey: string | null;
};

type PatchViewModel = {
  files: PatchViewFile[];
  fileDiffByPath: Map<string, FileDiffMetadata>;
  totals: PatchLineTotals | null;
  gitStatus: GitStatusEntry[] | undefined;
  getSuggestionSeedForDraftTarget: (
    target: DraftReviewCommentTarget | null,
  ) => string | undefined;
  getSuggestionSeedForThread: (thread: ReviewThread) => string | undefined;
};

type CreatePatchViewModelArgs = {
  fileDiffs: FileDiffMetadata[];
  lineStats: PatchLineTotals | null;
  reviewThreads: ReviewThread[];
  draftCommentTarget: DraftReviewCommentTarget | null;
  activeComposerKey: string | null;
};

function getFileStatus(fileDiff: FileDiffMetadata): GitStatusEntry["status"] {
  if (fileDiff.type === "new") return "added";
  if (fileDiff.type === "deleted") return "deleted";
  return "modified";
}

function buildFileStats(fileDiffs: FileDiffMetadata[]) {
  if (fileDiffs.length === 0) return null;

  const fileStats = new Map<string, FileStatsEntry>();
  for (const fileDiff of fileDiffs) {
    fileStats.set(fileDiff.name, {
      additions: fileDiff.additionLines.length,
      deletions: fileDiff.deletionLines.length,
      status: getFileStatus(fileDiff),
    });
  }

  return fileStats;
}

function buildGitStatus(
  fileStats: Map<string, FileStatsEntry> | null,
): GitStatusEntry[] | undefined {
  if (!fileStats) return undefined;

  const entries: GitStatusEntry[] = [];
  for (const [path, entry] of fileStats) {
    entries.push({ path, status: entry.status });
  }

  return entries;
}

function getPatchLineTotals(
  lineStats: PatchLineTotals | null,
  fileStats: Map<string, FileStatsEntry> | null,
): PatchLineTotals | null {
  if (lineStats) return lineStats;
  if (!fileStats) return null;

  let additions = 0;
  let deletions = 0;
  for (const entry of fileStats.values()) {
    additions += entry.additions;
    deletions += entry.deletions;
  }

  return { additions, deletions };
}

function buildFileDiffByPath(fileDiffs: FileDiffMetadata[]) {
  return new Map(
    fileDiffs.map((fileDiff) => [normalizePath(fileDiff.name), fileDiff]),
  );
}

function getDraftsForFile(
  draftCommentTarget: DraftReviewCommentTarget | null,
  normalizedFilePath: string,
) {
  let lineDraft: Extract<DraftReviewCommentTarget, { type: "line" }> | null =
    null;
  let fileDraft: Extract<DraftReviewCommentTarget, { type: "file" }> | null =
    null;

  if (
    draftCommentTarget?.type === "line" &&
    normalizePath(draftCommentTarget.path) === normalizedFilePath
  ) {
    lineDraft = draftCommentTarget;
  }

  if (
    draftCommentTarget?.type === "file" &&
    normalizePath(draftCommentTarget.path) === normalizedFilePath
  ) {
    fileDraft = draftCommentTarget;
  }

  return { fileDraft, lineDraft };
}

function buildPatchViewFiles({
  activeComposerKey,
  draftCommentTarget,
  fileDiffs,
  reviewThreads,
}: Pick<
  CreatePatchViewModelArgs,
  "activeComposerKey" | "draftCommentTarget" | "fileDiffs" | "reviewThreads"
>): PatchViewFile[] {
  const reviewThreadsByFile = buildReviewThreadsByFile(reviewThreads);

  return fileDiffs.map((fileDiff) => {
    const normalizedPath = normalizePath(fileDiff.name);
    const fileReviewThreads = getFileReviewThreadsForPath(
      reviewThreadsByFile,
      normalizedPath,
    );
    const { fileDraft, lineDraft } = getDraftsForFile(
      draftCommentTarget,
      normalizedPath,
    );

    return {
      fileDiff,
      normalizedPath,
      fileReviewThreads,
      fileDraft,
      fileLevelActiveComposerKey: getFileLevelActiveComposerKey(
        activeComposerKey,
        fileDraft,
        fileReviewThreads.fileThreads,
      ),
      lineDraft,
    };
  });
}

function getSuggestionSeedForDraftTarget(
  fileDiffByPath: Map<string, FileDiffMetadata>,
  target: DraftReviewCommentTarget | null,
) {
  if (
    !target ||
    target.type !== "line" ||
    !isAdditionOnlyReviewRange({
      endSide: target.side,
      hasStartLine: target.startLine !== null,
      startSide: target.startSide,
    })
  ) {
    return undefined;
  }

  return getSuggestionSeedForLineRange(
    fileDiffByPath.get(normalizePath(target.path)),
    target.startLine ?? target.line,
    target.line,
  );
}

function getSuggestionSeedForThread(
  fileDiffByPath: Map<string, FileDiffMetadata>,
  thread: ReviewThread,
) {
  if (
    thread.subjectType !== "line" ||
    thread.line === null ||
    !isAdditionOnlyReviewRange({
      endSide: thread.side,
      hasStartLine: thread.startLine !== null,
      startSide: thread.startSide,
    })
  ) {
    return undefined;
  }

  return getSuggestionSeedForLineRange(
    fileDiffByPath.get(normalizePath(thread.path)),
    thread.startLine ?? thread.line,
    thread.line,
  );
}

function createPatchViewModel({
  activeComposerKey,
  draftCommentTarget,
  fileDiffs,
  lineStats,
  reviewThreads,
}: CreatePatchViewModelArgs): PatchViewModel {
  const fileStats = buildFileStats(fileDiffs);
  const fileDiffByPath = buildFileDiffByPath(fileDiffs);

  return {
    files: buildPatchViewFiles({
      activeComposerKey,
      draftCommentTarget,
      fileDiffs,
      reviewThreads,
    }),
    fileDiffByPath,
    totals: getPatchLineTotals(lineStats, fileStats),
    gitStatus: buildGitStatus(fileStats),
    getSuggestionSeedForDraftTarget: (target) =>
      getSuggestionSeedForDraftTarget(fileDiffByPath, target),
    getSuggestionSeedForThread: (thread) =>
      getSuggestionSeedForThread(fileDiffByPath, thread),
  };
}

function usePatchViewModel({
  activeComposerKey,
  draftCommentTarget,
  fileDiffs,
  lineStats,
  reviewThreads,
}: CreatePatchViewModelArgs): PatchViewModel {
  return useMemo(
    () =>
      createPatchViewModel({
        activeComposerKey,
        draftCommentTarget,
        fileDiffs,
        lineStats,
        reviewThreads,
      }),
    [activeComposerKey, draftCommentTarget, fileDiffs, lineStats, reviewThreads],
  );
}

export {
  buildFileDiffByPath,
  buildFileStats,
  buildGitStatus,
  buildPatchViewFiles,
  createPatchViewModel,
  getPatchLineTotals,
  getSuggestionSeedForDraftTarget,
  getSuggestionSeedForThread,
  usePatchViewModel,
};
export type { PatchLineTotals, PatchViewFile, PatchViewModel };
