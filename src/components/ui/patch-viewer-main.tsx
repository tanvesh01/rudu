import { startTransition, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { ChapterOverview } from "./chapter-overview";
import { LlmSettingsModal } from "./llm-settings-modal";
import { ResizableHandle } from "./resizable-handle";
import { ReviewCommentEditor } from "./review-comment-editor";
import { ReviewThreadCard } from "./review-thread-card";
import {
  usePullRequestChaptersMutation,
  usePullRequestReviewCommentMutations,
} from "../../hooks/use-github-queries";
import { useDiffNavigator } from "../../hooks/use-diff-navigator";
import { useResizablePanelGroup } from "../../hooks/use-resizable-panel-group";
import {
  getFileReviewThreadsForPath,
  isActiveReviewThread,
  normalizePath,
  type FileReviewThreads,
  type ReviewComment,
  type ReviewThread,
  type ReviewThreadAnnotation,
} from "../../lib/review-threads";
import { llmSettingsQueryOptions } from "../../queries/llm";
import type {
  ChapterReviewFocus,
  ChapterReviewStep,
  FileStatsEntry,
  PullRequestChapter,
  PullRequestChapterFile,
  PullRequestChapters,
  ReviewCommentSide,
} from "../../types/github";

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

type AiHunkNoteAnnotation = {
  kind: "ai-note";
  title: string;
  detail: string;
};

type PatchLineAnnotation =
  | ReviewThreadAnnotation
  | DraftReviewCommentAnnotation
  | AiHunkNoteAnnotation;

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
  chapters: PullRequestChapters | null;
  isChaptersLoading: boolean;
  chaptersError: string;
  parsedPatch: {
    fileDiffs: FileDiffMetadata[];
    parseError: string;
  };
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

function formatCompactCount(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

function findChapterFile(
  chapter: PullRequestChapter | null,
  path: string,
): PullRequestChapterFile | null {
  if (!chapter) return null;

  const normalizedPath = normalizePath(path);
  return (
    chapter.files.find((file) => normalizePath(file.path) === normalizedPath) ??
    null
  );
}

function getFirstChapterPath(
  chapter: PullRequestChapter | null,
  step: ChapterReviewStep | null = null,
) {
  if (!chapter) return null;
  return step?.files[0] ?? chapter.files[0]?.path ?? null;
}

function findChapterForFocus(
  chapters: PullRequestChapters | null,
  focus: ChapterReviewFocus,
) {
  if (!chapters) return null;

  if (focus.path) {
    const normalizedFocusPath = normalizePath(focus.path);
    const fileMatch = chapters.chapters.find((chapter) =>
      chapter.files.some(
        (file) => normalizePath(file.path) === normalizedFocusPath,
      ),
    );
    if (fileMatch) return fileMatch;

    const riskPathMatch = chapters.chapters.find((chapter) =>
      chapter.risks.some(
        (risk) =>
          risk.path !== null && normalizePath(risk.path) === normalizedFocusPath,
      ),
    );
    if (riskPathMatch) return riskPathMatch;
  }

  const normalizedFocusTitle = focus.title.trim().toLowerCase();
  return (
    chapters.chapters.find((chapter) =>
      chapter.risks.some(
        (risk) => risk.title.trim().toLowerCase() === normalizedFocusTitle,
      ),
    ) ??
    chapters.chapters.find((chapter) =>
      chapter.title.toLowerCase().includes(normalizedFocusTitle),
    ) ??
    chapters.chapters[0] ??
    null
  );
}

function getFirstChangedAnnotationTarget(fileDiff: FileDiffMetadata) {
  for (const hunk of fileDiff.hunks) {
    for (const content of hunk.hunkContent) {
      if (content.type !== "change") continue;

      if (content.additions > 0) {
        return {
          side: "additions" as const,
          lineNumber:
            hunk.additionStart +
            Math.max(0, content.additionLineIndex - hunk.additionLineIndex),
        };
      }

      if (content.deletions > 0) {
        return {
          side: "deletions" as const,
          lineNumber:
            hunk.deletionStart +
            Math.max(0, content.deletionLineIndex - hunk.deletionLineIndex),
        };
      }
    }
  }

  return null;
}

function getRiskForPath(chapter: PullRequestChapter, path: string) {
  const normalizedPath = normalizePath(path);
  return (
    chapter.risks.find(
      (risk) =>
        risk.path !== null && normalizePath(risk.path) === normalizedPath,
    ) ??
    chapter.risks[0] ??
    null
  );
}

function buildAiHunkNoteAnnotation(
  fileDiff: FileDiffMetadata,
  chapter: PullRequestChapter | null,
): DiffLineAnnotation<AiHunkNoteAnnotation> | null {
  if (!chapter) return null;

  const target = getFirstChangedAnnotationTarget(fileDiff);
  if (!target) return null;

  const chapterFile = findChapterFile(chapter, fileDiff.name);
  const risk = getRiskForPath(chapter, fileDiff.name);
  const detail =
    chapterFile?.reason ||
    risk?.detail ||
    chapter.summary ||
    "AI grouped this hunk into the selected review chapter.";

  return {
    ...target,
    metadata: {
      kind: "ai-note",
      title: risk?.title ?? chapter.title,
      detail,
    },
  };
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
  chapters,
  isChaptersLoading,
  chaptersError,
  parsedPatch,
  fileStats,
  gitStatus,
}: PatchViewerMainProps) {
  const [draftCommentTarget, setDraftCommentTarget] =
    useState<DraftReviewCommentTarget | null>(null);
  const [draftCommentError, setDraftCommentError] = useState("");
  const [isLlmSettingsOpen, setIsLlmSettingsOpen] = useState(false);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
    null,
  );
  const [selectedReviewStepIndex, setSelectedReviewStepIndex] = useState<
    number | null
  >(null);
  const [completedChapterIds, setCompletedChapterIds] = useState<Set<string>>(
    () => new Set(),
  );
  const chapterPanelLayout = useResizablePanelGroup({
    id: "chapter-overview",
    orientation: "vertical",
    controlledPanel: "first",
    defaultSize: 28,
    minSize: 14,
    maxSize: 44,
  });
  const reviewSidePanelLayout = useResizablePanelGroup({
    id: "review-side-panel",
    orientation: "horizontal",
    controlledPanel: "second",
    defaultSize: 33,
    minSize: 22,
    maxSize: 50,
  });
  const fileCommentsPanelLayout = useResizablePanelGroup({
    id: "file-comments",
    orientation: "vertical",
    controlledPanel: "first",
    defaultSize: 60,
    minSize: 35,
    maxSize: 78,
  });
  const hasSelection = selectedPrKey !== null;
  const shouldShowCommentsPanel =
    hasSelection &&
    (isReviewThreadsLoading ||
      Boolean(reviewThreadsError) ||
      reviewThreads.length > 0);
  const navigator = useDiffNavigator({
    prKey: selectedPrKey,
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
  const chapterMutation = usePullRequestChaptersMutation(
    selectedPatch
      ? {
          repo: selectedPatch.repo,
          number: selectedPatch.number,
          headSha: selectedPatch.headSha,
        }
      : null,
  );
  const llmSettingsQuery = useQuery({
    ...llmSettingsQueryOptions(),
    enabled: hasSelection,
  });
  const llmSettings = llmSettingsQuery.data ?? null;

  const selectedChapter = useMemo(
    () =>
      chapters?.chapters.find((chapter) => chapter.id === selectedChapterId) ??
      null,
    [chapters, selectedChapterId],
  );
  const selectedReviewStep = useMemo(() => {
    if (!selectedChapter || selectedReviewStepIndex === null) {
      return null;
    }

    return selectedChapter.reviewSteps[selectedReviewStepIndex] ?? null;
  }, [selectedChapter, selectedReviewStepIndex]);
  const selectedChapterFileSet = useMemo(() => {
    if (!selectedChapter) return null;
    const reviewStepFiles = selectedReviewStep?.files ?? [];
    const visibleFiles =
      reviewStepFiles.length > 0
        ? reviewStepFiles
        : selectedChapter.files.map((file) => file.path);

    return new Set(visibleFiles.map((file) => normalizePath(file)));
  }, [selectedChapter, selectedReviewStep]);
  const visibleChangedFiles = useMemo(() => {
    if (!selectedChapterFileSet) return changedFiles;
    return changedFiles.filter((path) =>
      selectedChapterFileSet.has(normalizePath(path)),
    );
  }, [changedFiles, selectedChapterFileSet]);
  const visibleFileDiffs = useMemo(() => {
    if (!selectedChapterFileSet) return parsedPatch.fileDiffs;
    return parsedPatch.fileDiffs.filter((fileDiff) =>
      selectedChapterFileSet.has(normalizePath(fileDiff.name)),
    );
  }, [parsedPatch.fileDiffs, selectedChapterFileSet]);
  const aiNoteFilePaths = useMemo(() => {
    if (!selectedChapter) return new Set<string>();

    const notePaths = new Set<string>();
    for (const fileDiff of visibleFileDiffs) {
      if (!buildAiHunkNoteAnnotation(fileDiff, selectedChapter)) {
        continue;
      }

      notePaths.add(normalizePath(fileDiff.name));
      if (notePaths.size >= 2) break;
    }

    return notePaths;
  }, [selectedChapter, visibleFileDiffs]);
  const selectedReviewLabel =
    selectedReviewStep?.title ?? selectedChapter?.title ?? null;
  const changedFilesContext = selectedChapter
    ? {
        title: selectedReviewStep
          ? `Chapter files: ${selectedReviewStep.title}`
          : `Chapter files: ${selectedChapter.title}`,
        detail:
          selectedReviewStep?.detail ||
          selectedChapter.summary ||
          "Showing only files matched to the selected AI chapter.",
      }
    : null;

  useEffect(() => {
    setDraftCommentTarget(null);
    setDraftCommentError("");
    setSelectedChapterId(null);
    setSelectedReviewStepIndex(null);
    setCompletedChapterIds(new Set());
  }, [selectedPrKey]);

  useEffect(() => {
    if (!selectedChapterId) return;
    if (chapters?.chapters.some((chapter) => chapter.id === selectedChapterId)) {
      return;
    }

    setSelectedChapterId(null);
    setSelectedReviewStepIndex(null);
  }, [chapters, selectedChapterId]);

  useEffect(() => {
    if (selectedReviewStepIndex === null) return;
    if (
      selectedChapter &&
      selectedReviewStepIndex < selectedChapter.reviewSteps.length
    ) {
      return;
    }

    setSelectedReviewStepIndex(null);
  }, [selectedChapter, selectedReviewStepIndex]);

  useEffect(() => {
    navigator.actions.notifyDiffContentChanged();
  }, [
    navigator.actions,
    parsedPatch.fileDiffs,
    reviewThreadsByFile,
    selectedChapterFileSet,
  ]);

  function handleSelectChapter(chapterId: string | null) {
    const nextChapter =
      chapters?.chapters.find((chapter) => chapter.id === chapterId) ?? null;

    startTransition(() => {
      setSelectedChapterId(chapterId);
      setSelectedReviewStepIndex(null);
    });

    const firstPath = getFirstChapterPath(nextChapter);
    if (firstPath) {
      navigator.tree.onSelectFile(firstPath);
    }
  }

  function handleSelectReviewStep(stepIndex: number | null) {
    const nextStep =
      selectedChapter && stepIndex !== null
        ? selectedChapter.reviewSteps[stepIndex] ?? null
        : null;

    startTransition(() => {
      setSelectedReviewStepIndex(stepIndex);
    });

    const firstPath = getFirstChapterPath(selectedChapter, nextStep);
    if (firstPath) {
      navigator.tree.onSelectFile(firstPath);
    }
  }

  function handleSelectReviewFocus(focus: ChapterReviewFocus) {
    const chapter = findChapterForFocus(chapters, focus);
    const firstPath = focus.path ?? getFirstChapterPath(chapter);

    startTransition(() => {
      setSelectedChapterId(chapter?.id ?? null);
      setSelectedReviewStepIndex(null);
    });

    if (firstPath) {
      navigator.tree.onSelectFile(firstPath);
    }
  }

  function handleToggleChapterComplete(chapterId: string) {
    setCompletedChapterIds((current) => {
      const next = new Set(current);
      if (next.has(chapterId)) {
        next.delete(chapterId);
      } else {
        next.add(chapterId);
      }
      return next;
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

  function renderReviewThreadAnnotations(
    annotation: DiffLineAnnotation<PatchLineAnnotation>,
  ) {
    if ("kind" in annotation.metadata && annotation.metadata.kind === "draft") {
      return (
        <ReviewCommentEditor
          error={draftCommentError}
          isPending={createCommentMutation.isPending}
          selectedLineLabel={getSelectedLineLabel(draftCommentTarget)}
          submitLabel="Comment"
          onCancel={() => {
            setDraftCommentError("");
            setDraftCommentTarget(null);
          }}
          onSubmit={handleSubmitDraftComment}
        />
      );
    }

    if (
      "kind" in annotation.metadata &&
      annotation.metadata.kind === "ai-note"
    ) {
      return (
        <div className="w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide">
            <span>AI note</span>
            <span className="min-w-0 break-words text-amber-700 dark:text-amber-300">
              {annotation.metadata.title}
            </span>
          </div>
          <p className="whitespace-normal break-words leading-5 [overflow-wrap:anywhere]">
            {annotation.metadata.detail}
          </p>
        </div>
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

  if (!hasSelection) {
    return (
      <main className="h-full min-h-0 min-w-0 pl-0">
        <section className="h-full min-h-0 min-w-0 overflow-hidden">
          <img
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
            src="/outerworld.jpg"
          />
        </section>
      </main>
    );
  }

  return (
    <>
      <main className="h-full min-h-0 min-w-0 pl-0">
        <div
          ref={chapterPanelLayout.containerRef}
          className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface"
        >
          <div
            className="min-h-[128px] shrink-0 overflow-hidden"
            style={chapterPanelLayout.panelStyle}
          >
            <ChapterOverview
              chapters={chapters}
              error={chaptersError}
              generationError={
                chapterMutation.error instanceof Error
                  ? chapterMutation.error.message
                  : chapterMutation.error
                    ? String(chapterMutation.error)
                    : ""
              }
              isGenerating={chapterMutation.isPending}
              isLoading={isChaptersLoading}
              completedChapterIds={completedChapterIds}
              onGenerate={() => void chapterMutation.mutate()}
              onOpenSettings={() => setIsLlmSettingsOpen(true)}
              onSelectChapter={handleSelectChapter}
              onSelectReviewFocus={handleSelectReviewFocus}
              onSelectReviewStep={handleSelectReviewStep}
              onToggleChapterComplete={handleToggleChapterComplete}
              reviewThreadsByFile={reviewThreadsByFile}
              selectedChapterId={selectedChapterId}
              selectedReviewStepIndex={selectedReviewStepIndex}
              settings={llmSettings}
              settingsError={
                llmSettingsQuery.error instanceof Error
                  ? llmSettingsQuery.error.message
                  : llmSettingsQuery.error
                    ? String(llmSettingsQuery.error)
                    : ""
              }
            />
          </div>
          <ResizableHandle
            {...chapterPanelLayout.handleProps}
            label="Resize AI summary panel"
            orientation="vertical"
          />
          <div
            ref={reviewSidePanelLayout.containerRef}
            className="flex min-h-0 min-w-0 flex-1"
          >
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
                  {selectedChapter ? (
                    <div className="sticky top-0 z-20 border-b border-ink-200 bg-surface/95 px-4 py-2 backdrop-blur">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <p className="min-w-0 truncate font-medium text-ink-900">
                          Reviewing: {selectedReviewLabel}
                        </p>
                        <p className="shrink-0 font-mono text-xs font-semibold">
                          <span className="text-emerald-600 dark:text-emerald-300">
                            +{formatCompactCount(selectedChapter.additions)}
                          </span>{" "}
                          <span className="text-red-600 dark:text-red-300">
                            -{formatCompactCount(selectedChapter.deletions)}
                          </span>
                        </p>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-ink-500">
                        {visibleChangedFiles.length} matched files - AI notes are
                        limited to the highest-signal hunks.
                      </p>
                    </div>
                  ) : null}

                  {parsedPatch.parseError ? (
                    <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center text-danger-600 md:min-h-full">
                      {parsedPatch.parseError}
                    </div>
                  ) : parsedPatch.fileDiffs.length === 0 ? (
                    <pre className="m-0 overflow-auto scrollbar-hidden whitespace-pre-wrap break-words p-5">
                      {selectedPatch.patch}
                    </pre>
                  ) : visibleFileDiffs.length === 0 ? (
                    <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center text-sm text-ink-500 md:min-h-full">
                      No parsed diffs matched this AI summary.
                    </div>
                  ) : (
                    <div className="flex flex-col bg-white dark:bg-surface">
                      {visibleFileDiffs.map((fileDiff) => {
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

                        const aiHunkNote =
                          selectedChapter &&
                          aiNoteFilePaths.has(normalizedFilePath)
                            ? buildAiHunkNoteAnnotation(
                                fileDiff,
                                selectedChapter,
                              )
                            : null;
                        const baseLineAnnotations: DiffLineAnnotation<PatchLineAnnotation>[] =
                          aiHunkNote
                            ? [
                                ...fileReviewThreads.lineAnnotations,
                                aiHunkNote,
                              ]
                            : fileReviewThreads.lineAnnotations;
                        const lineAnnotations: DiffLineAnnotation<PatchLineAnnotation>[] =
                          lineDraft
                            ? [
                                ...baseLineAnnotations,
                                {
                                  side: toSelectionSide(lineDraft.side),
                                  lineNumber: lineDraft.line,
                                  metadata: { kind: "draft" },
                                },
                              ]
                            : baseLineAnnotations;
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
                                    key={getThreadRefKey(thread)}
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
            </div>
            <ResizableHandle
              {...reviewSidePanelLayout.handleProps}
              label="Resize file tree and comments"
              orientation="horizontal"
            />
            <div
              className="min-h-0 min-w-[260px] shrink-0"
              style={reviewSidePanelLayout.panelStyle}
            >
              <div
                ref={fileCommentsPanelLayout.containerRef}
                className={cx(
                  "flex h-full min-h-0 min-w-0 flex-col",
                  shouldShowCommentsPanel && "bg-surface",
                )}
              >
                <div
                  style={
                    shouldShowCommentsPanel
                      ? fileCommentsPanelLayout.panelStyle
                      : undefined
                  }
                  className={cx(
                    "min-h-0 overflow-hidden",
                    shouldShowCommentsPanel
                      ? "min-h-[180px] shrink-0"
                      : "flex-1",
                  )}
                >
                  <ChangedFilesTree
                    error={changedFilesError}
                    files={visibleChangedFiles}
                    hasSelection={hasSelection}
                    isDark={isDark}
                    isLoading={isChangedFilesLoading}
                    onSelectFile={navigator.tree.onSelectFile}
                    selectedFilePath={navigator.tree.selectedFilePath}
                    showContainer={false}
                    fileStats={fileStats}
                    gitStatus={gitStatus}
                    chapterContext={changedFilesContext}
                  />
                </div>

                {shouldShowCommentsPanel ? (
                  <>
                    <ResizableHandle
                      {...fileCommentsPanelLayout.handleProps}
                      label="Resize files and comments"
                      orientation="vertical"
                    />
                    <div className="min-h-[140px] flex-1 overflow-y-auto scrollbar-hidden bg-surface">
                      <ReviewThreadsPanel
                        threads={reviewThreads}
                        isLoading={isReviewThreadsLoading}
                        error={reviewThreadsError}
                        hasSelection={hasSelection}
                      />
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </main>
      <LlmSettingsModal
        onOpenChange={setIsLlmSettingsOpen}
        open={isLlmSettingsOpen}
      />
    </>
  );
}

export { PatchViewerMain };
export type { PatchViewerMainProps };
