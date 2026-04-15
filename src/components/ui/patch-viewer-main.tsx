import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange,
  VirtualFileMetrics,
  VirtualizerConfig,
} from "@pierre/diffs";
import type { GitStatusEntry } from "@pierre/trees";
import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import { ChangedFilesTree } from "./changed-files-tree";
import { ReviewCommentEditor } from "./review-comment-editor";
import { ReviewThreadCard } from "./review-thread-card";
import { usePullRequestReviewCommentMutations } from "../../hooks/use-github-queries";
import {
  getFileReviewThreadsForPath,
  normalizePath,
  type FileReviewThreads,
  type ReviewComment,
  type ReviewThread,
  type ReviewThreadAnnotation,
} from "../../lib/review-threads";
import type { FileStatsEntry, ReviewCommentSide } from "../../types/github";

const VIRTUALIZER_CONFIG: Partial<VirtualizerConfig> = {
  overscrollSize: 1200,
};

const VIRTUAL_FILE_METRICS: VirtualFileMetrics = {
  hunkLineCount: 50,
  lineHeight: 20,
  diffHeaderHeight: 44,
  hunkSeparatorHeight: 32,
  fileGap: 16,
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

type PatchViewerMainProps = {
  selectedPrKey: string | null;
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
  fileStats: Map<string, FileStatsEntry> | null;
  gitStatus: GitStatusEntry[] | undefined;
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

type ReviewThreadsPanelProps = {
  threads: ReviewThread[];
  isLoading: boolean;
  error: string;
  hasSelection: boolean;
  viewerLogin: string | null;
  onReplyToThread?: (thread: ReviewThread, body: string) => Promise<void>;
  onEditComment?: (comment: ReviewComment, body: string) => Promise<void>;
};

function ReviewThreadsPanel({
  threads,
  isLoading,
  error,
  hasSelection,
  viewerLogin,
  onReplyToThread,
  onEditComment,
}: ReviewThreadsPanelProps) {
  const activeThreads = threads.filter((t) => !t.isResolved && !t.isOutdated);
  const resolvedThreads = threads.filter((t) => t.isResolved || t.isOutdated);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 py-2 text-xs text-neutral-500">
        <p className="text-sm text-neutral-800">
          Comments{" "}
          <span className="ml-2 text-neutral-500">{threads.length}</span>
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!hasSelection ? (
          <div className="flex items-center justify-center py-6 text-center text-sm text-ink-500">
            Select a pull request to load comments.
          </div>
        ) : null}

        {hasSelection && isLoading ? (
          <div className="flex items-center justify-center py-6 text-center text-sm text-ink-500">
            Loading comments...
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

        {activeThreads.length > 0 ? (
          <div className="mb-3">
            <div className="sticky top-0 z-10 bg-surface px-1 py-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
              Active{" "}
              <span className="font-normal text-ink-400">
                {activeThreads.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {activeThreads.map((thread) => (
                <ReviewThreadCard
                  key={thread.id}
                  compact
                  thread={thread}
                  viewerLogin={viewerLogin}
                  onReplyToThread={onReplyToThread}
                  onEditComment={onEditComment}
                />
              ))}
            </div>
          </div>
        ) : null}

        {resolvedThreads.length > 0 ? (
          <div>
            <div className="sticky top-0 z-10 bg-surface px-1 py-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
              Resolved / Outdated{" "}
              <span className="font-normal text-ink-400">
                {resolvedThreads.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {resolvedThreads.map((thread) => (
                <ReviewThreadCard
                  key={thread.id}
                  compact
                  thread={thread}
                  viewerLogin={viewerLogin}
                  onReplyToThread={onReplyToThread}
                  onEditComment={onEditComment}
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
  selectedPatch,
  isPatchLoading,
  patchError,
  changedFiles,
  isChangedFilesLoading,
  changedFilesError,
  reviewThreadsByFile,
  reviewThreads,
  isReviewThreadsLoading,
  reviewThreadsError,
  parsedPatch,
  fileStats,
  gitStatus,
}: PatchViewerMainProps) {
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [draftCommentTarget, setDraftCommentTarget] =
    useState<DraftReviewCommentTarget | null>(null);
  const [draftCommentError, setDraftCommentError] = useState("");
  const pendingScrollPathRef = useRef<string | null>(null);
  const fileDiffRefMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const hasSelection = selectedPrKey !== null;
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

  const setFileDiffRef = useCallback(
    (path: string, node: HTMLDivElement | null) => {
      if (node) {
        fileDiffRefMap.current.set(path, node);
        return;
      }

      fileDiffRefMap.current.delete(path);
    },
    [],
  );

  const scrollToDiffFile = useCallback((path: string) => {
    const normalizedTargetPath = normalizePath(path);

    const directMatch = fileDiffRefMap.current.get(path);
    if (directMatch) {
      directMatch.scrollIntoView({
        behavior: "auto",
        block: "start",
        inline: "nearest",
      });
      return true;
    }

    for (const [filePath, node] of fileDiffRefMap.current) {
      if (normalizePath(filePath) !== normalizedTargetPath) continue;
      node.scrollIntoView({
        behavior: "auto",
        block: "start",
        inline: "nearest",
      });
      return true;
    }

    return false;
  }, []);

  const handleSelectFile = useCallback(
    (path: string) => {
      setSelectedFilePath(path);

      if (scrollToDiffFile(path)) {
        pendingScrollPathRef.current = null;
        return;
      }

      pendingScrollPathRef.current = path;
    },
    [scrollToDiffFile],
  );

  useEffect(() => {
    setSelectedFilePath(null);
    setDraftCommentTarget(null);
    setDraftCommentError("");
    pendingScrollPathRef.current = null;
    fileDiffRefMap.current.clear();
  }, [selectedPrKey]);

  useEffect(() => {
    const pendingPath = pendingScrollPathRef.current;
    if (
      !pendingPath ||
      isPatchLoading ||
      patchError ||
      parsedPatch.parseError
    ) {
      return;
    }

    if (scrollToDiffFile(pendingPath)) {
      pendingScrollPathRef.current = null;
    }
  }, [
    isPatchLoading,
    patchError,
    parsedPatch.fileDiffs,
    parsedPatch.parseError,
    scrollToDiffFile,
  ]);

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

    setDraftCommentError("");
    setDraftCommentTarget({
      type: "line",
      path,
      line: endLine,
      side: endGithubSide,
      startLine: startLine !== endLine ? startLine : null,
      startSide: startLine !== endLine ? startGithubSide : null,
    });
  }

  function openFileCommentDraft(path: string) {
    setDraftCommentError("");
    setDraftCommentTarget({ type: "file", path });
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
      setDraftCommentTarget(null);
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
  }

  async function handleEditComment(comment: ReviewComment, body: string) {
    if (!selectedPatch || !comment.id) {
      throw new Error("This comment cannot be edited from the app.");
    }

    await updateCommentMutation.mutateAsync({
      commentId: comment.id,
      body,
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
                ? "bg-amber-100 text-amber-700"
                : "bg-emerald-100 text-emerald-700",
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
        <button
          className="rounded-full bg-canvas px-2 py-0.5 text-ink-700 transition hover:bg-surface hover:text-ink-900"
          onClick={() => openFileCommentDraft(path)}
          type="button"
        >
          File comment
        </button>
      </div>
    );
  }

  function renderReviewThreadAnnotations(
    annotation: DiffLineAnnotation<PatchLineAnnotation>,
  ) {
    if ("kind" in annotation.metadata && annotation.metadata.kind === "draft") {
      return (
        <ReviewCommentEditor
          error={draftCommentError}
          isPending={createCommentMutation.isPending}
          submitLabel="Comment"
          onCancel={() => {
            setDraftCommentError("");
            setDraftCommentTarget(null);
          }}
          onSubmit={handleSubmitDraftComment}
        />
      );
    }

    const threadAnnotation = annotation.metadata as ReviewThreadAnnotation;

    return (
      <ReviewThreadCard
        compact
        onEditComment={handleEditComment}
        onReplyToThread={handleReplyToThread}
        thread={threadAnnotation.thread}
        viewerLogin={viewerLogin}
      />
    );
  }

  return (
    <main className="h-full min-h-0 min-w-0 pl-0">
      <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface">
        <Group orientation="horizontal" className="min-h-0 min-w-0 flex-1">
          <Panel defaultSize="66%" minSize="30%">
            <Virtualizer
              className="relative min-h-0 min-w-0 overflow-y-auto"
              config={VIRTUALIZER_CONFIG}
              contentClassName="flex min-h-full flex-col bg-white "
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
                  Loading patch...
                </div>
              ) : null}

              {!isPatchLoading && patchError ? (
                <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center text-danger-600 md:min-h-full">
                  {patchError}
                </div>
              ) : null}

              {!isPatchLoading && !patchError && isReviewThreadsLoading ? (
                <div className="px-4 pb-2 pt-1 text-sm text-ink-500">
                  Loading review threads...
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
                    <pre className="m-0 overflow-auto whitespace-pre-wrap break-words p-5">
                      {selectedPatch.patch}
                    </pre>
                  ) : (
                    <div className="flex flex-col bg-white">
                      {parsedPatch.fileDiffs.map((fileDiff, index) => {
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
                            key={`${selectedPatch.repo}-${selectedPatch.number}-${index}`}
                            ref={(node) => setFileDiffRef(fileDiff.name, node)}
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
                                enableGutterUtility:
                                  draftCommentTarget === null,
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
                                  <ReviewCommentEditor
                                    error={draftCommentError}
                                    isPending={createCommentMutation.isPending}
                                    submitLabel="Comment"
                                    onCancel={() => {
                                      setDraftCommentError("");
                                      setDraftCommentTarget(null);
                                    }}
                                    onSubmit={handleSubmitDraftComment}
                                  />
                                ) : null}
                                {fileReviewThreads.fileThreads.map((thread) => (
                                  <ReviewThreadCard
                                    key={thread.id}
                                    onEditComment={handleEditComment}
                                    onReplyToThread={handleReplyToThread}
                                    thread={thread}
                                    viewerLogin={viewerLogin}
                                  />
                                ))}
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
          </Panel>
          <Separator className="w-1 shrink-0" />
          <Panel defaultSize="34%" minSize="15%">
            <div className="flex h-full min-h-0 min-w-0 flex-col divide-y divide-ink-200">
              <div className="min-h-0 flex-[3] overflow-hidden">
                <ChangedFilesTree
                  error={changedFilesError}
                  files={changedFiles}
                  hasSelection={hasSelection}
                  isLoading={isChangedFilesLoading}
                  onSelectFile={handleSelectFile}
                  selectedFilePath={selectedFilePath}
                  showContainer={false}
                  fileStats={fileStats}
                  gitStatus={gitStatus}
                />
              </div>

              <div className="min-h-0 flex-[2] overflow-y-auto bg-surface">
                <ReviewThreadsPanel
                  threads={reviewThreads}
                  isLoading={isReviewThreadsLoading}
                  error={reviewThreadsError}
                  hasSelection={hasSelection}
                  viewerLogin={viewerLogin}
                  onReplyToThread={handleReplyToThread}
                  onEditComment={handleEditComment}
                />
              </div>
            </div>
          </Panel>
        </Group>
      </section>
    </main>
  );
}

export { PatchViewerMain };
export type { PatchViewerMainProps };
