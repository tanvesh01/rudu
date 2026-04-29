import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type {
  ChangeContent,
  ContextContent,
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange,
  VirtualFileMetrics,
  VirtualizerConfig,
} from "@pierre/diffs";
import type { GitStatusEntry } from "@pierre/trees";
import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import { ChangedFilesTree } from "./changed-files-tree";
import { DotMatrixLoader } from "./dot-matrix-loader";
import {
  inferCodeLanguageFromPath,
  ReviewCommentComposer,
} from "./review-comment-composer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";
import { ReviewThreadCard } from "./review-thread-card";
import { OuterworldAttribution } from "./outerworld-attribution";
import { useDiffNavigator } from "../../hooks/use-diff-navigator";
import { isAdditionOnlyReviewRange } from "../../lib/review-suggestions";
import { usePullRequestReviewCommentMutations } from "../../hooks/usePullRequestReviewCommentMutations";
import {
  getFileReviewThreadsForPath,
  isActiveReviewThread,
  normalizePath,
  type FileReviewThreads,
  type ReviewComment,
  type ReviewThread,
  type ReviewThreadAnnotation,
} from "../../lib/review-threads";
import type { FileStatsEntry, ReviewCommentSide } from "../../types/github";

const VIRTUALIZER_CONFIG: Partial<VirtualizerConfig> = {
  overscrollSize: 1200,
  resizeDebugging: import.meta.env.DEV,
};

const VIRTUAL_FILE_METRICS: VirtualFileMetrics = {
  hunkLineCount: 50,
  lineHeight: 20,
  diffHeaderHeight: 44,
  hunkSeparatorHeight: 32,
  fileGap: 8,
};

const DIFF_FONT_STYLE = {
  "--diffs-font-family":
    '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  "--diffs-header-font-family":
    '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as CSSProperties;

type SelectedPatch = {
  repo: string;
  number: number;
  headSha: string;
  patch: string;
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

type DraftReviewCommentAnnotation = {
  kind: "draft";
};

type PatchLineAnnotation =
  | ReviewThreadAnnotation
  | DraftReviewCommentAnnotation;

type ComposerViewState = {
  activeComposerKey: string | null;
  draftTarget: DraftReviewCommentTarget | null;
};

type PatchViewerMainProps = {
  selectedPrKey: string | null;
  selectedDiffKey: string | null;
  selectedPatch: SelectedPatch | null;
  isPatchLoading: boolean;
  patchError: string;
  changedFiles: string[];
  isChangedFilesLoading: boolean;
  changedFilesError: string;
  reviewThreadsByFile: Map<string, FileReviewThreads>;
  reviewThreads: ReviewThread[];
  isReviewThreadsLoading: boolean;
  reviewThreadsError: string;
  parsedPatch: {
    fileDiffs: FileDiffMetadata[];
    parseError: string;
  };
  lineStats: {
    additions: number;
    deletions: number;
  } | null;
  fileStats: Map<string, FileStatsEntry> | null;
  gitStatus: GitStatusEntry[] | undefined;
  isDark: boolean;
};

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

function toGithubSide(side: SelectedLineRange["side"]): ReviewCommentSide {
  return side === "deletions" ? "LEFT" : "RIGHT";
}

function toSelectionSide(side: ReviewCommentSide | null | undefined) {
  return side === "LEFT" ? "deletions" : "additions";
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

type ReviewThreadsPanelProps = {
  threads: ReviewThread[];
  isLoading: boolean;
  error: string;
  hasSelection: boolean;
};

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

function isContextContent(
  content: ContextContent | ChangeContent,
): content is ContextContent {
  return content.type === "context";
}

function getAdditionLineTextMap(fileDiff: FileDiffMetadata) {
  const lineMap = new Map<number, string>();

  for (const hunk of fileDiff.hunks) {
    let nextAdditionLine = hunk.additionStart;

    for (const content of hunk.hunkContent) {
      if (isContextContent(content)) {
        for (let index = 0; index < content.lines; index += 1) {
          lineMap.set(
            nextAdditionLine + index,
            fileDiff.additionLines[content.additionLineIndex + index] ?? "",
          );
        }
        nextAdditionLine += content.lines;
        continue;
      }

      for (let index = 0; index < content.additions; index += 1) {
        lineMap.set(
          nextAdditionLine + index,
          fileDiff.additionLines[content.additionLineIndex + index] ?? "",
        );
      }
      nextAdditionLine += content.additions;
    }
  }

  return lineMap;
}

function getSuggestionSeedForLineRange(
  fileDiff: FileDiffMetadata | undefined,
  startLine: number | null,
  endLine: number | null,
) {
  if (!fileDiff || startLine === null || endLine === null) {
    return undefined;
  }

  const lineMap = getAdditionLineTextMap(fileDiff);
  const minLine = Math.min(startLine, endLine);
  const maxLine = Math.max(startLine, endLine);
  const selectedLines: string[] = [];

  for (let lineNumber = minLine; lineNumber <= maxLine; lineNumber += 1) {
    const line = lineMap.get(lineNumber);
    if (line === undefined) {
      return undefined;
    }
    selectedLines.push(line);
  }

  return selectedLines.join("\n");
}

function ReviewThreadsPanel({
  threads,
  isLoading,
  error,
  hasSelection,
}: ReviewThreadsPanelProps) {
  const activeThreads = threads.filter(isActiveReviewThread);
  const resolvedThreads = threads.filter((t) => t.isResolved || t.isOutdated);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 py-3 text-xs text-ink-500 flex items-center gap-2">
        <p className="text-sm font-medium text-ink-500">Comments</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hidden px-2 pb-2">
        {!hasSelection ? (
          <div className="flex items-center justify-center py-6 text-center text-sm text-ink-500">
            Select a pull request to load comments.
          </div>
        ) : null}

        {hasSelection && isLoading ? (
          <div className="flex items-center justify-center py-6 text-center text-sm text-ink-500">
            <DotMatrixLoader label="Loading comments" size="sm" variant="wave" />
          </div>
        ) : null}

        {hasSelection && !isLoading && error ? (
          <div className="flex items-center justify-center py-6 text-center text-sm text-danger-600">
            {error}
          </div>
        ) : null}

        {hasSelection && !isLoading && !error && threads.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-center text-sm text-ink-500">
            No comments on this PR.
          </div>
        ) : null}

        {hasSelection &&
        !isLoading &&
        !error &&
        threads.length > 0 &&
        activeThreads.length === 0 ? (
          <div className="mb-3 rounded-lg px-3  text-sm text-emerald-800  dark:text-emerald-300">
            No active comments. You&apos;re in the clear!
          </div>
        ) : null}

        {activeThreads.length > 0 ? (
          <div className="mb-3">
            <div className="sticky top-0 z-10 mb-2 bg-surface px-1 py-1 text-xs font-medium tracking-wide text-ink-500">
              Active
              <span className="ml-2 text-ink-400">{activeThreads.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {activeThreads.map((thread) => (
                <ReviewThreadCard
                  key={getThreadRefKey(thread)}
                  slim
                  thread={thread}
                />
              ))}
            </div>
          </div>
        ) : null}

        {resolvedThreads.length > 0 ? (
          <div>
            <div className="sticky top-0 z-10 mb-2 bg-surface px-1 py-1 text-xs font-medium tracking-wide text-ink-500">
              Inactive
              <span className="ml-2 text-ink-400">
                {resolvedThreads.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {resolvedThreads.map((thread) => (
                <ReviewThreadCard
                  key={getThreadRefKey(thread)}
                  slim
                  thread={thread}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PatchViewerMain({
  selectedPrKey,
  selectedDiffKey,
  selectedPatch,
  isPatchLoading,
  isDark,
  patchError,
  changedFiles,
  isChangedFilesLoading,
  changedFilesError,
  reviewThreadsByFile,
  reviewThreads,
  isReviewThreadsLoading,
  reviewThreadsError,
  parsedPatch,
  lineStats,
  fileStats,
  gitStatus,
}: PatchViewerMainProps) {
  const [draftCommentTarget, setDraftCommentTarget] =
    useState<DraftReviewCommentTarget | null>(null);
  const [activeComposerKey, setActiveComposerKey] = useState<string | null>(
    null,
  );
  const [isActiveComposerDirty, setIsActiveComposerDirty] = useState(false);
  const [pendingComposerState, setPendingComposerState] =
    useState<ComposerViewState | null>(null);
  const [draftCommentError, setDraftCommentError] = useState("");
  const hasSelection = selectedPrKey !== null;
  const shouldShowCommentsPanel =
    hasSelection &&
    (isReviewThreadsLoading ||
      Boolean(reviewThreadsError) ||
      reviewThreads.length > 0);
  const navigator = useDiffNavigator({
    prKey: selectedDiffKey,
    isDiffReady: !isPatchLoading && !patchError && !parsedPatch.parseError,
    hasDiffError: Boolean(patchError || parsedPatch.parseError),
  });
  const {
    createCommentMutation,
    replyCommentMutation,
    updateCommentMutation,
    viewerLogin,
  } = usePullRequestReviewCommentMutations(
    selectedPatch
      ? {
          repo: selectedPatch.repo,
          number: selectedPatch.number,
          headSha: selectedPatch.headSha,
        }
      : null,
  );

  useEffect(() => {
    setDraftCommentTarget(null);
    setActiveComposerKey(null);
    setIsActiveComposerDirty(false);
    setPendingComposerState(null);
    setDraftCommentError("");
  }, [selectedDiffKey]);

  useEffect(() => {
    navigator.actions.notifyDiffContentChanged();
  }, [navigator.actions, parsedPatch.fileDiffs, reviewThreadsByFile]);

  const fileDiffByPath = new Map(
    parsedPatch.fileDiffs.map((fileDiff) => [normalizePath(fileDiff.name), fileDiff]),
  );

  function applyComposerState(nextState: ComposerViewState) {
    setActiveComposerKey(nextState.activeComposerKey);
    setDraftCommentTarget(nextState.draftTarget);
    setIsActiveComposerDirty(false);
    setPendingComposerState(null);
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
    requestComposerState({
      activeComposerKey: getDraftComposerKey(nextDraftTarget),
      draftTarget: nextDraftTarget,
    });
  }

  async function handleSubmitDraftComment(body: string) {
    if (!selectedPatch || !draftCommentTarget) {
      return;
    }

    setDraftCommentError("");

    try {
      await createCommentMutation.mutateAsync({
        repo: selectedPatch.repo,
        number: selectedPatch.number,
        body,
        path: draftCommentTarget.path,
        line:
          draftCommentTarget.type === "line" ? draftCommentTarget.line : null,
        side:
          draftCommentTarget.type === "line" ? draftCommentTarget.side : null,
        startLine:
          draftCommentTarget.type === "line"
            ? draftCommentTarget.startLine
            : null,
        startSide:
          draftCommentTarget.type === "line"
            ? draftCommentTarget.startSide
            : null,
        subjectType: draftCommentTarget.type === "file" ? "file" : "line",
      });
      applyComposerState({
        activeComposerKey: null,
        draftTarget: null,
      });
    } catch (error) {
      setDraftCommentError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function handleReplyToThread(thread: ReviewThread, body: string) {
    if (!selectedPatch) {
      return;
    }

    if (!thread.id) {
      throw new Error("This thread cannot be replied to from the app.");
    }

    await replyCommentMutation.mutateAsync({
      threadId: thread.id,
      body,
    });

    applyComposerState({
      activeComposerKey: null,
      draftTarget: null,
    });
  }

  async function handleEditComment(comment: ReviewComment, body: string) {
    if (!selectedPatch || !comment.id) {
      throw new Error("This comment cannot be edited from the app.");
    }

    await updateCommentMutation.mutateAsync({
      commentId: comment.id,
      body,
    });

    applyComposerState({
      activeComposerKey: null,
      draftTarget: null,
    });
  }

  function renderReviewThreadSummary(
    fileReviewThreads: FileReviewThreads,
    path: string,
  ) {
    const hasDraft =
      draftCommentTarget?.type === "file" &&
      normalizePath(draftCommentTarget.path) === normalizePath(path);

    return (
      <div className="flex items-center gap-2 text-xs text-ink-500">
        {fileReviewThreads.totalCount > 0 ? (
          <span className="rounded-full bg-canvas px-2 py-0.5 text-ink-700">
            {fileReviewThreads.totalCount} threads
          </span>
        ) : null}
        {fileReviewThreads.totalCount > 0 ? (
          <span
            className={cx(
              "rounded-full px-2 py-0.5",
              fileReviewThreads.unresolvedCount > 0
                ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
            )}
          >
            {fileReviewThreads.unresolvedCount > 0
              ? `${fileReviewThreads.unresolvedCount} open`
              : "All resolved"}
          </span>
        ) : null}
        {hasDraft ? (
          <span className="rounded-full bg-canvas px-2 py-0.5 text-ink-700">
            Draft open
          </span>
        ) : null}
        {fileReviewThreads.fileThreads.length > 0 ? (
          <span className="text-ink-500">
            {fileReviewThreads.fileThreads.length} file-level
          </span>
        ) : null}
      </div>
    );
  }

  function getSuggestionSeedForDraftTarget(target: DraftReviewCommentTarget | null) {
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

  function getSuggestionSeedForThread(thread: ReviewThread) {
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

  function renderReviewThreadAnnotations(
    annotation: DiffLineAnnotation<PatchLineAnnotation>,
  ) {
    if ("kind" in annotation.metadata && annotation.metadata.kind === "draft") {
      const suggestionSeed = getSuggestionSeedForDraftTarget(draftCommentTarget);

      return (
        <ReviewCommentComposer
          allowSuggestion={Boolean(suggestionSeed)}
          error={draftCommentError}
          isPending={createCommentMutation.isPending}
          selectedLineLabel={getSelectedLineLabel(draftCommentTarget)}
          suggestionLanguage={
            draftCommentTarget
              ? inferCodeLanguageFromPath(draftCommentTarget.path)
              : "text"
          }
          suggestionSeed={suggestionSeed}
          submitLabel="Comment"
          onCancel={() => {
            setDraftCommentError("");
            closeActiveComposer();
          }}
          onDirtyChange={setIsActiveComposerDirty}
          onSubmit={handleSubmitDraftComment}
        />
      );
    }

    const threadAnnotation = annotation.metadata as ReviewThreadAnnotation;
    const suggestionSeed = getSuggestionSeedForThread(threadAnnotation.thread);

    return (
      <ReviewThreadCard
        activeEditCommentId={
          activeComposerKey?.startsWith("edit:")
            ? activeComposerKey.slice("edit:".length)
            : null
        }
        compact
        isReplyComposerActive={
          activeComposerKey === getReplyComposerKey(threadAnnotation.thread)
        }
        suggestionLanguage={inferCodeLanguageFromPath(
          threadAnnotation.thread.path,
        )}
        suggestionSeed={suggestionSeed}
        onComposerDirtyChange={setIsActiveComposerDirty}
        onEditComment={handleEditComment}
        onReplyToThread={handleReplyToThread}
        onRequestCloseComposer={closeActiveComposer}
        onRequestEditComposer={(comment) => {
          requestComposerState({
            activeComposerKey: getEditComposerKey(comment),
            draftTarget: null,
          });
        }}
        onRequestReplyComposer={(thread) => {
          requestComposerState({
            activeComposerKey: getReplyComposerKey(thread),
            draftTarget: null,
          });
        }}
        thread={threadAnnotation.thread}
        viewerLogin={viewerLogin}
      />
    );
  }

  if (!hasSelection) {
    return (
      <main className="h-full min-h-0 min-w-0 pl-0">
        <section className="relative h-full min-h-0 min-w-0 overflow-hidden">
          <img
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
            src="/outerworld.jpg"
          />
          <OuterworldAttribution />
        </section>
      </main>
    );
  }

  return (
    <main className="h-full min-h-0 min-w-0 pl-0">
      <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface">
        <div className="flex min-h-0 min-w-0 flex-1">
          <div className="min-h-0 min-w-[30%] flex-1">
            <Virtualizer
              className="relative h-full min-h-0 min-w-0 overflow-y-auto scrollbar-hidden"
              config={VIRTUALIZER_CONFIG}
              contentClassName="flex min-h-full flex-col bg-white dark:bg-surface"
            >
              {!selectedPrKey && !isPatchLoading ? (
                <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 px-6 py-10 text-center md:min-h-full">
                  <strong>Select a pull request.</strong>
                  <span className="text-sm text-ink-600">
                    The PR patch will render here with Pierre Diffs.
                  </span>
                </div>
              ) : null}

              {isPatchLoading ? (
                <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center md:min-h-full">
                  <DotMatrixLoader label="Loading patch" />
                </div>
              ) : null}
              {!isPatchLoading && patchError ? (
                <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center text-danger-600 md:min-h-full">
                  {patchError}
                </div>
              ) : null}

              {!isPatchLoading && !patchError && isReviewThreadsLoading ? (
                <div className="px-4 pb-2 pt-2 text-sm text-ink-500">
                  <DotMatrixLoader
                    label="Loading review threads"
                    size="sm"
                    variant="scan"
                  />
                </div>
              ) : null}
              {!isPatchLoading && !patchError && reviewThreadsError ? (
                <div className="px-4 pb-2 pt-1 text-sm text-danger-600">
                  {reviewThreadsError}
                </div>
              ) : null}

              {!isPatchLoading && !patchError && selectedPatch ? (
                <div className="flex min-h-[50vh] flex-col md:min-h-full h-full">
                  {parsedPatch.parseError ? (
                    <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center text-danger-600 md:min-h-full">
                      {parsedPatch.parseError}
                    </div>
                  ) : parsedPatch.fileDiffs.length === 0 ? (
                    <pre className="m-0 overflow-auto scrollbar-hidden whitespace-pre-wrap break-words p-5">
                      {selectedPatch.patch}
                    </pre>
                  ) : (
                    <div className="flex flex-col bg-white dark:bg-surface">
                      {parsedPatch.fileDiffs.map((fileDiff) => {
                        const fileReviewThreads = getFileReviewThreadsForPath(
                          reviewThreadsByFile,
                          fileDiff.name,
                        );
                        const normalizedFilePath = normalizePath(fileDiff.name);
                        let lineDraft: Extract<
                          DraftReviewCommentTarget,
                          { type: "line" }
                        > | null = null;
                        let fileDraft: Extract<
                          DraftReviewCommentTarget,
                          { type: "file" }
                        > | null = null;

                        if (
                          draftCommentTarget?.type === "line" &&
                          normalizePath(draftCommentTarget.path) ===
                            normalizedFilePath
                        ) {
                          lineDraft = draftCommentTarget;
                        }

                        if (
                          draftCommentTarget?.type === "file" &&
                          normalizePath(draftCommentTarget.path) ===
                            normalizedFilePath
                        ) {
                          fileDraft = draftCommentTarget;
                        }

                        const lineAnnotations: DiffLineAnnotation<PatchLineAnnotation>[] =
                          lineDraft
                            ? [
                                ...fileReviewThreads.lineAnnotations,
                                {
                                  side: toSelectionSide(lineDraft.side),
                                  lineNumber: lineDraft.line,
                                  metadata: { kind: "draft" },
                                },
                              ]
                            : fileReviewThreads.lineAnnotations;
                        const selectedLines: SelectedLineRange | null =
                          lineDraft
                            ? {
                                start: lineDraft.startLine ?? lineDraft.line,
                                side: toSelectionSide(
                                  lineDraft.startSide ?? lineDraft.side,
                                ),
                                end: lineDraft.line,
                                endSide: toSelectionSide(lineDraft.side),
                              }
                            : null;

                        return (
                          <div
                            data-file-path={fileDiff.name}
                            key={`${selectedPatch.repo}-${selectedPatch.number}-${normalizePath(fileDiff.name)}`}
                            ref={(node) =>
                              navigator.diff.registerDiffNode(
                                fileDiff.name,
                                node,
                              )
                            }
                          >
                            <FileDiff
                              fileDiff={fileDiff}
                              metrics={VIRTUAL_FILE_METRICS}
                              lineAnnotations={lineAnnotations}
                              selectedLines={selectedLines}
                              style={DIFF_FONT_STYLE}
                              options={{
                                theme: {
                                  dark: "pierre-dark",
                                  light: "pierre-light",
                                },
                                diffStyle: "unified",
                                diffIndicators: "bars",
                                lineDiffType: "word",
                                overflow: "scroll",
                                unsafeCSS: `
                                  [data-overflow='scroll'],
                                  [data-code] {
                                    scrollbar-width: none;
                                    -ms-overflow-style: none;
                                  }

                                  [data-overflow='scroll']::-webkit-scrollbar,
                                  [data-code]::-webkit-scrollbar {
                                    display: none;
                                    width: 0;
                                    height: 0;
                                  }

                                  [data-code]::-webkit-scrollbar-track,
                                  [data-code]::-webkit-scrollbar-corner,
                                  [data-code]::-webkit-scrollbar-thumb,
                                  [data-diff]:hover [data-code]::-webkit-scrollbar-thumb,
                                  [data-file]:hover [data-code]::-webkit-scrollbar-thumb {
                                    background-color: transparent !important;
                                  }

                                  [data-column-number][data-selected-line]::before {
                                    background-color: #f59e0b;
                                    background-image: none;
                                  }
                                `,
                                enableGutterUtility: true,
                                onGutterUtilityClick: (range) =>
                                  openLineCommentDraft(fileDiff.name, range),
                              }}
                              renderAnnotation={renderReviewThreadAnnotations}
                              renderHeaderMetadata={() =>
                                renderReviewThreadSummary(
                                  fileReviewThreads,
                                  fileDiff.name,
                                )
                              }
                            />
                            {fileReviewThreads.fileThreads.length > 0 ||
                            fileDraft ? (
                              <div className="mt-3 flex flex-col gap-3 rounded-xl border border-ink-200 bg-surface p-3">
                                <div className="text-xs font-medium uppercase tracking-wide text-ink-500">
                                  File threads
                                </div>
                                {fileDraft ? (
                                  <ReviewCommentComposer
                                    allowSuggestion={false}
                                    error={draftCommentError}
                                    isPending={createCommentMutation.isPending}
                                    suggestionLanguage={inferCodeLanguageFromPath(
                                      fileDiff.name,
                                    )}
                                    submitLabel="Comment"
                                    onCancel={() => {
                                      setDraftCommentError("");
                                      closeActiveComposer();
                                    }}
                                    onDirtyChange={setIsActiveComposerDirty}
                                    onSubmit={handleSubmitDraftComment}
                                  />
                                ) : null}
                                {fileReviewThreads.fileThreads.map((thread) => {
                                  const suggestionSeed =
                                    getSuggestionSeedForThread(thread);

                                  return (
                                    <ReviewThreadCard
                                      activeEditCommentId={
                                        activeComposerKey?.startsWith("edit:")
                                          ? activeComposerKey.slice("edit:".length)
                                          : null
                                      }
                                      isReplyComposerActive={
                                        activeComposerKey ===
                                        getReplyComposerKey(thread)
                                      }
                                      suggestionLanguage={inferCodeLanguageFromPath(
                                        thread.path,
                                      )}
                                      suggestionSeed={suggestionSeed}
                                      onComposerDirtyChange={
                                        setIsActiveComposerDirty
                                      }
                                      key={getThreadRefKey(thread)}
                                      onEditComment={handleEditComment}
                                      onReplyToThread={handleReplyToThread}
                                      onRequestCloseComposer={closeActiveComposer}
                                      onRequestEditComposer={(comment) => {
                                        requestComposerState({
                                          activeComposerKey:
                                            getEditComposerKey(comment),
                                          draftTarget: null,
                                        });
                                      }}
                                      onRequestReplyComposer={(replyThread) => {
                                        requestComposerState({
                                          activeComposerKey:
                                            getReplyComposerKey(replyThread),
                                          draftTarget: null,
                                        });
                                      }}
                                      thread={thread}
                                      viewerLogin={viewerLogin}
                                    />
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}
            </Virtualizer>
          </div>
          <div className="min-h-0 w-1/3 min-w-[15%] shrink-0">
            <div
              className={cx(
                "flex h-full min-h-0 min-w-0 flex-col",
                shouldShowCommentsPanel && "divide-y divide-ink-200",
              )}
            >
              <div
                className={cx(
                  "min-h-0 overflow-hidden",
                  shouldShowCommentsPanel ? "flex-[3]" : "flex-1",
                )}
              >
                <ChangedFilesTree
                  error={changedFilesError}
                  files={changedFiles}
                  hasSelection={hasSelection}
                  isDark={isDark}
                  isLoading={isChangedFilesLoading}
                  lineStats={lineStats}
                  onSelectFile={navigator.tree.onSelectFile}
                  selectedFilePath={navigator.tree.selectedFilePath}
                  showContainer={false}
                  fileStats={fileStats}
                  gitStatus={gitStatus}
                />
              </div>

              {shouldShowCommentsPanel ? (
                <div className="min-h-0 flex-[2] overflow-y-auto scrollbar-hidden bg-surface">
                  <ReviewThreadsPanel
                    threads={reviewThreads}
                    isLoading={isReviewThreadsLoading}
                    error={reviewThreadsError}
                    hasSelection={hasSelection}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingComposerState(null);
          }
        }}
        open={pendingComposerState !== null}
      >
        <AlertDialogContent className="p-4">
          <AlertDialogHeader className="!gap-0">
            <AlertDialogTitle>Discard draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Opening another comment editor will discard your unsaved changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingComposerState) {
                  applyComposerState(pendingComposerState);
                }
              }}
              type="button"
            >
              Discard and continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

export { PatchViewerMain };
export type { PatchViewerMainProps };
