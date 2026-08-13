import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Tabs } from "@base-ui/react/tabs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DiffLineAnnotation, FileDiffMetadata } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { ChangedFilesTree } from "./changed-files-tree";
import {
  DiffStyleToggle,
  LeftSidebarToggle,
  RightSidebarToggle,
} from "./diff-style-toggle";
import { useDiffStyle } from "../../hooks/use-diff-style";
import { useAppShellContext } from "../app-shell/app-shell-context";
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
import { ReviewNoteCard } from "./review-note-card";
import { OuterworldAttribution } from "./outerworld-attribution";
import { PullRequestDetailsPanel } from "./pull-request-details-panel";
import {
  getCodeViewItemId,
  PatchCodeView,
  type PatchLineAnnotation,
} from "../patch-viewer/patch-code-view";
import {
  usePatchReviewComposerSession,
  type PatchReviewCommentApi,
} from "../patch-viewer/use-patch-review-composer-session";
import {
  getReplyComposerKey,
  getSelectedLineLabel,
  getThreadRefKey,
} from "../patch-viewer/review-composer-state";
import {
  isActiveReviewThread,
  type FileReviewThreads,
  type ReviewThread,
} from "../../lib/review-threads";
import type { PullRequestPanel } from "../../lib/pull-request-route";
import type {
  PullRequestChecks,
  PullRequestOverview,
} from "../../types/github";
import { SUBMIT_COMMENT_SHORTCUT } from "../../lib/keyboard-shortcuts";
import {
  usePatchViewModel,
  type PatchLineTotals,
} from "../patch-viewer/patch-view-model";

type SelectedPatch = {
  repo: string;
  number: number;
  headSha: string;
  patch: string;
};

type PullRequestDetailsState = {
  checks: PullRequestChecks | null;
  checksError: string;
  isChecksLoading: boolean;
  isChecksRefreshing: boolean;
  isOverviewLoading: boolean;
  onRefreshChecks: () => void;
  overview: PullRequestOverview | null;
  overviewError: string;
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
  reviewComments: PatchReviewCommentApi;
  reviewThreads: ReviewThread[];
  reviewThreadsByFile: Map<string, FileReviewThreads>;
  isReviewThreadsLoading: boolean;
  reviewThreadsError: string;
  parsedPatch: {
    fileDiffs: FileDiffMetadata[];
    parseError: string;
  };
  lineStats: PatchLineTotals | null;
  rightSidebarTab: RightSidebarTab;
  onRightSidebarTabChange: (tab: RightSidebarTab) => void;
  pullRequestDetails: PullRequestDetailsState;
  reviewPublish?: {
    count: number;
    isPending: boolean;
    onClick: () => void;
  };
  isDark: boolean;
};

type RightSidebarTab = PullRequestPanel;

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

// Keeps memoized diff sections from rerendering for handler identity churn while
// still calling the latest handler implementation when the event fires.
function useStableEvent<TArgs extends unknown[], TReturn>(
  callback: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  const callbackRef = useRef(callback);

  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  return useCallback((...args: TArgs) => callbackRef.current(...args), []);
}

type ReviewThreadsPanelProps = {
  threads: ReviewThread[];
  isLoading: boolean;
  error: string;
  hasSelection: boolean;
  onPromoteNote?: (noteId: string) => void;
  onSelectThread: (thread: ReviewThread) => void;
  reviewPublish?: {
    count: number;
    isPending: boolean;
    onClick: () => void;
  };
};

function ReviewThreadsPanel({
  threads,
  isLoading,
  error,
  hasSelection,
  onPromoteNote,
  onSelectThread,
  reviewPublish,
}: ReviewThreadsPanelProps) {
  const notes = threads.filter((thread) => thread.source === "note");
  const drafts = threads.filter((thread) => thread.source === "comment-draft");
  const githubThreads = threads.filter((thread) => thread.source === "github");
  const activeThreads = githubThreads.filter(isActiveReviewThread);
  const resolvedThreads = githubThreads.filter(
    (thread) => thread.isResolved || thread.isOutdated,
  );

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

        {notes.length > 0 ? (
          <div className="mb-3 rounded-lg border border-amber-200/70 p-2 dark:border-amber-900/50">
            <div className="mb-2 px-1 text-xs font-medium tracking-wide text-amber-700 dark:text-amber-300">
              Notes (private) <span className="ml-2">{notes.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {notes.map((thread) => (
                <ReviewNoteCard
                  key={getThreadRefKey(thread)}
                  compact
                  onClick={() => onSelectThread(thread)}
                  onPromote={onPromoteNote}
                  thread={thread}
                />
              ))}
            </div>
          </div>
        ) : null}

        {drafts.length > 0 ? (
          <div className="mb-3 rounded-lg border border-blue-200/70 p-2 dark:border-blue-900/50">
            <div className="mb-2 px-1 text-xs font-medium tracking-wide text-blue-700 dark:text-blue-300">
              Draft comments <span className="ml-2">{drafts.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {drafts.map((thread) => (
                <ReviewThreadCard
                  key={getThreadRefKey(thread)}
                  onClick={() => onSelectThread(thread)}
                  slim
                  thread={thread}
                />
              ))}
            </div>
            {reviewPublish && reviewPublish.count > 0 ? (
              <button
                className="mt-3 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-default disabled:opacity-60"
                disabled={reviewPublish.isPending}
                onClick={reviewPublish.onClick}
                type="button"
              >
                {reviewPublish.isPending
                  ? "Posting…"
                  : `Post ${reviewPublish.count} comment${reviewPublish.count === 1 ? "" : "s"} to GitHub`}
              </button>
            ) : null}
          </div>
        ) : null}

        {activeThreads.length > 0 ? (
          <div className="mb-3">
            <div className="sticky top-0 z-10 mb-2 bg-surface px-1 py-1 text-xs font-medium tracking-wide text-ink-500">
              GitHub comments
              <span className="ml-2 text-ink-400">{activeThreads.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {activeThreads.map((thread) => (
                <ReviewThreadCard
                  key={getThreadRefKey(thread)}
                  onClick={() => onSelectThread(thread)}
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
                  onClick={() => onSelectThread(thread)}
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
  reviewComments,
  reviewThreads,
  reviewThreadsByFile,
  isReviewThreadsLoading,
  reviewThreadsError,
  parsedPatch,
  lineStats,
  rightSidebarTab,
  onRightSidebarTabChange,
  pullRequestDetails,
  reviewPublish,
}: PatchViewerMainProps) {
  const appWindow = getCurrentWindow();
  const {
    finishSessionNavigation,
    isLeftSidebarOpen,
    sessionNavigation,
    toggleLeftSidebar,
  } = useAppShellContext();
  const [diffStyle, setDiffStyle] = useDiffStyle();
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [pendingScrollFilePath, setPendingScrollFilePath] = useState<
    string | null
  >(null);
  const codeViewRef = useRef<CodeViewHandle<PatchLineAnnotation> | null>(null);
  const threadCardRefs = useRef(new Map<string, HTMLDivElement>());
  const setThreadCardRef = useCallback(
    (thread: ReviewThread, node: HTMLDivElement | null) => {
      const key = getThreadRefKey(thread);
      if (node) threadCardRefs.current.set(key, node);
      else threadCardRefs.current.delete(key);
    },
    [],
  );
  const handledSessionNavigationRef = useRef<typeof sessionNavigation>(null);
  const hasSelection = selectedPrKey !== null;
  const isDiffReady = !isPatchLoading && !patchError && !parsedPatch.parseError;
  const shouldShowCommentsPanel =
    hasSelection &&
    (isReviewThreadsLoading ||
      Boolean(reviewThreadsError) ||
      reviewThreads.length > 0);
  const {
    activeComposerKey,
    draftCommentTarget,
    getDraftComposerState,
    getEditComposerState,
    getReplyComposerState,
    pendingComposerState,
    viewerLogin,
    actions: composerActions,
  } = usePatchReviewComposerSession({
    reviewComments,
    selectedDiffKey,
    selectedPatch,
  });
  const patchViewModel = usePatchViewModel({
    draftCommentTarget,
    fileDiffs: parsedPatch.fileDiffs,
    lineStats,
    reviewThreadsByFile,
  });
  useEffect(() => {
    setSelectedFilePath(null);
    setPendingScrollFilePath(null);
  }, [selectedDiffKey]);

  useEffect(() => {
    if (!selectedFilePath) return;
    if (
      patchViewModel.fileDiffByPath.has(getCodeViewItemId(selectedFilePath))
    ) {
      return;
    }

    setSelectedFilePath(null);
    setPendingScrollFilePath((path) =>
      path === selectedFilePath ? null : path,
    );
  }, [patchViewModel.fileDiffByPath, selectedFilePath]);

  const scrollCodeViewToFile = useCallback((path: string) => {
    const itemId = getCodeViewItemId(path);
    const codeView = codeViewRef.current;
    if (!codeView?.getItem(itemId)) {
      return false;
    }

    codeView.scrollTo({
      type: "item",
      id: itemId,
      align: "start",
      behavior: "instant",
    });
    return true;
  }, []);

  useEffect(() => {
    if (!pendingScrollFilePath || !isDiffReady) return;
    if (!scrollCodeViewToFile(pendingScrollFilePath)) return;

    setPendingScrollFilePath(null);
  }, [isDiffReady, pendingScrollFilePath, scrollCodeViewToFile]);

  const handleSelectThread = useCallback(
    (thread: ReviewThread) => {
      const id = getCodeViewItemId(thread.path);
      const codeView = codeViewRef.current;
      if (!codeView?.getItem(id)) return;

      setSelectedFilePath(id);
      if (thread.line === null) {
        scrollCodeViewToFile(thread.path);
        return;
      }

      codeView.scrollTo({
        type: "line",
        id,
        lineNumber: thread.line,
        side:
          thread.side === "LEFT"
            ? "deletions"
            : thread.side === "RIGHT"
              ? "additions"
              : undefined,
        align: "center",
        behavior: "instant",
      });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          threadCardRefs.current
            .get(getThreadRefKey(thread))
            ?.scrollIntoView({ block: "center" });
        });
      });
    },
    [scrollCodeViewToFile],
  );

  const handleSelectFile = useCallback((path: string) => {
    setSelectedFilePath(path);
    setPendingScrollFilePath(path);
  }, []);

  useEffect(() => {
    if (
      !sessionNavigation ||
      handledSessionNavigationRef.current === sessionNavigation ||
      sessionNavigation.target.kind !== "pull_request" ||
      !selectedPatch ||
      sessionNavigation.target.repo !== selectedPatch.repo ||
      sessionNavigation.target.number !== selectedPatch.number ||
      !isDiffReady
    ) {
      return;
    }
    const id = getCodeViewItemId(sessionNavigation.file);
    const codeView = codeViewRef.current;
    if (!codeView?.getItem(id)) return;

    handledSessionNavigationRef.current = sessionNavigation;
    setSelectedFilePath(sessionNavigation.file);
    setPendingScrollFilePath(null);
    codeView.scrollTo({
      type: "line",
      id,
      lineNumber: sessionNavigation.line,
      side: sessionNavigation.side,
      align: "center",
      behavior: "instant",
    });
    finishSessionNavigation(sessionNavigation);
  }, [
    finishSessionNavigation,
    isDiffReady,
    patchViewModel,
    selectedPatch,
    sessionNavigation,
  ]);

  function renderReviewThreadAnnotations(
    annotation: DiffLineAnnotation<PatchLineAnnotation>,
  ) {
    if ("kind" in annotation.metadata && annotation.metadata.kind === "draft") {
      const suggestionSeed =
        patchViewModel.getSuggestionSeedForDraftTarget(draftCommentTarget);
      const draftComposerState = getDraftComposerState(draftCommentTarget);

      return (
        <ReviewCommentComposer
          allowSuggestion={false}
          error={draftComposerState.error}
          initialValue={draftComposerState.initialValue}
          isPending={draftComposerState.isPending}
          selectedLineLabel={getSelectedLineLabel(draftCommentTarget)}
          suggestionLanguage={
            draftCommentTarget
              ? inferCodeLanguageFromPath(draftCommentTarget.path)
              : "text"
          }
          suggestionSeed={suggestionSeed}
          submitLabel="Save note"
          secondaryAction={{
            label: "Draft comment",
            shortcut: SUBMIT_COMMENT_SHORTCUT,
            onSubmit: composerActions.submitDraftComment,
          }}
          onCancel={stableCloseActiveComposer}
          onDirtyChange={stableSetActiveComposerDirty}
          onSubmit={composerActions.submitNote}
        />
      );
    }

    if (!("thread" in annotation.metadata)) {
      return null;
    }

    const threadAnnotation = annotation.metadata;
    if (threadAnnotation.thread.source === "note") {
      return (
        <ReviewNoteCard
          compact
          containerRef={(node) =>
            setThreadCardRef(threadAnnotation.thread, node)
          }
          onPromote={
            reviewComments.promoteNote
              ? (noteId) => void reviewComments.promoteNote?.(noteId)
              : undefined
          }
          thread={threadAnnotation.thread}
        />
      );
    }
    const suggestionSeed = patchViewModel.getSuggestionSeedForThread(
      threadAnnotation.thread,
    );
    const replyComposerState = getReplyComposerState(threadAnnotation.thread);

    return (
      <ReviewThreadCard
        activeEditCommentId={
          activeComposerKey?.startsWith("edit:")
            ? activeComposerKey.slice("edit:".length)
            : null
        }
        compact
        containerRef={(node) =>
          setThreadCardRef(threadAnnotation.thread, node)
        }
        isReplyComposerActive={
          activeComposerKey === getReplyComposerKey(threadAnnotation.thread)
        }
        getEditComposerState={getEditComposerState}
        replyComposerState={replyComposerState}
        suggestionLanguage={inferCodeLanguageFromPath(
          threadAnnotation.thread.path,
        )}
        suggestionSeed={suggestionSeed}
        onComposerDirtyChange={stableSetActiveComposerDirty}
        onEditComment={
          reviewComments.updateComment ? stableEditComment : undefined
        }
        onReplyToThread={
          reviewComments.replyToComment ? stableReplyToThread : undefined
        }
        onRequestCloseComposer={stableCloseActiveComposer}
        onRequestEditComposer={stableRequestEditComposer}
        onRequestReplyComposer={stableRequestReplyComposer}
        thread={threadAnnotation.thread}
        viewerLogin={viewerLogin}
      />
    );
  }

  const stableOpenLineCommentDraft = useStableEvent(
    composerActions.openLineCommentDraft,
  );
  const stableCloseActiveComposer = useStableEvent(
    composerActions.closeActiveComposer,
  );
  const stableSetActiveComposerDirty = useStableEvent(
    composerActions.setActiveComposerDirty,
  );
  const stableEditComment = useStableEvent(composerActions.editComment);
  const stableReplyToThread = useStableEvent(composerActions.replyToThread);
  const stableRequestEditComposer = useStableEvent(
    composerActions.requestEditComposer,
  );
  const stableRequestReplyComposer = useStableEvent(
    composerActions.requestReplyComposer,
  );

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
          <div className="relative min-h-0 min-w-[30%] flex-1">
            <div className="relative h-full min-h-0 min-w-0 overflow-hidden [overflow-anchor:none]">
              <div
                className={cx(
                  "flex h-10 shrink-0 items-center justify-between border-b border-ink-200/60 pr-2",
                  isLeftSidebarOpen ? "pl-2" : "pl-20",
                )}
                onMouseDown={(event) => {
                  if (
                    event.button !== 0 ||
                    (event.target as Element).closest("button")
                  )
                    return;
                  void appWindow.startDragging();
                }}
              >
                <LeftSidebarToggle
                  open={isLeftSidebarOpen}
                  onClick={toggleLeftSidebar}
                />
                <div className="flex items-center gap-1">
                  <DiffStyleToggle onChange={setDiffStyle} value={diffStyle} />
                  <RightSidebarToggle
                    open={isRightSidebarOpen}
                    onClick={() => setIsRightSidebarOpen((open) => !open)}
                  />
                </div>
              </div>
              {!selectedPrKey && !isPatchLoading ? (
                <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 px-6 py-10 text-center md:min-h-full">
                  <strong>Select a pull request.</strong>
                  <span className="text-sm text-ink-600">
                    The PR patch will render here with Pierre Diffs.
                  </span>
                </div>
              ) : null}

              {!isPatchLoading && patchError ? (
                <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center text-danger-600 md:min-h-full">
                  {patchError}
                </div>
              ) : null}

              {!isPatchLoading && !patchError && reviewThreadsError ? (
                <div className="px-4 pb-2 pt-1 text-sm text-danger-600">
                  {reviewThreadsError}
                </div>
              ) : null}

              {!isPatchLoading && !patchError && selectedPatch ? (
                <div className="flex h-[calc(100%-2.5rem)] min-h-0 flex-col">
                  {parsedPatch.parseError ? (
                    <div className="flex min-h-[50vh] items-center justify-center px-6 py-10 text-center text-danger-600 md:min-h-full">
                      {parsedPatch.parseError}
                    </div>
                  ) : parsedPatch.fileDiffs.length === 0 ? (
                    <pre className="m-0 overflow-auto scrollbar-hidden whitespace-pre-wrap break-words p-5">
                      {selectedPatch.patch}
                    </pre>
                  ) : (
                    <div className="h-full min-h-0 bg-white dark:bg-surface">
                      <PatchCodeView
                        codeViewRef={codeViewRef}
                        draftCommentTarget={draftCommentTarget}
                        files={patchViewModel.files}
                        isDark={isDark}
                        onOpenLineCommentDraft={stableOpenLineCommentDraft}
                        renderReviewThreadAnnotations={
                          renderReviewThreadAnnotations
                        }
                      />
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          {isRightSidebarOpen ? (
            <div className="min-h-0 w-1/3 min-w-[15%] shrink-0">
              <Tabs.Root
                className="flex h-full min-h-0 min-w-0 flex-col bg-surface"
                onValueChange={(value) => {
                  onRightSidebarTabChange(value as RightSidebarTab);
                }}
                value={rightSidebarTab}
              >
                <Tabs.List
                  className="relative z-0 flex shrink-0 items-center gap-1 bg-surface px-2 py-2"
                  onMouseDown={(event) => {
                    if (event.button !== 0) return;
                    if (event.target !== event.currentTarget) return;
                    void appWindow.startDragging();
                  }}
                >
                  <Tabs.Tab
                    className="flex h-8 items-center justify-center border-0 px-2 text-sm font-normal whitespace-nowrap text-ink-500 outline-none select-none before:inset-x-0 before:inset-y-1 before:rounded-md before:-outline-offset-1 before:outline-brand-600 transition hover:text-ink-900 focus-visible:relative focus-visible:before:absolute focus-visible:before:outline focus-visible:before:outline-2 data-[active]:text-ink-900"
                    value="changed-files"
                  >
                    <span>Changes</span>
                    {patchViewModel.totals ? (
                      <span className="ml-2 inline-flex items-center gap-1 font-mono text-xs font-bold">
                        <span className="text-emerald-600 dark:text-emerald-300">
                          +{formatCount(patchViewModel.totals.additions)}
                        </span>
                        <span className="text-red-500 dark:text-red-300">
                          −{formatCount(patchViewModel.totals.deletions)}
                        </span>
                      </span>
                    ) : null}
                  </Tabs.Tab>
                  <Tabs.Tab
                    className="flex h-8 items-center justify-center border-0 px-2 text-sm font-normal whitespace-nowrap text-ink-500 outline-none select-none before:inset-x-0 before:inset-y-1 before:rounded-md before:-outline-offset-1 before:outline-brand-600 transition hover:text-ink-900 focus-visible:relative focus-visible:before:absolute focus-visible:before:outline focus-visible:before:outline-2 data-[active]:text-ink-900"
                    value="pull-request"
                  >
                    Pull Request
                  </Tabs.Tab>
                  <Tabs.Indicator className="absolute left-0 top-1/2 z-[-1] h-7 w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] -translate-y-1/2 rounded-md bg-canvasDark transition-all duration-200 ease-in-out" />
                  <div
                    aria-hidden="true"
                    className="min-w-0 flex-1"
                    data-tauri-drag-region
                  />
                </Tabs.List>

                <Tabs.Panel className="min-h-0 flex-1" value="changed-files">
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
                        totals={patchViewModel.totals}
                        onSelectFile={handleSelectFile}
                        selectedFilePath={selectedFilePath}
                        showContainer={false}
                        showHeader={false}
                        gitStatus={patchViewModel.gitStatus}
                        reviewThreadsByFile={reviewThreadsByFile}
                      />
                    </div>

                    {shouldShowCommentsPanel ? (
                      <div className="min-h-0 flex-[2] overflow-y-auto scrollbar-hidden bg-surface">
                        <ReviewThreadsPanel
                          threads={reviewThreads}
                          isLoading={isReviewThreadsLoading}
                          error={reviewThreadsError}
                          hasSelection={hasSelection}
                          onPromoteNote={
                            reviewComments.promoteNote
                              ? (noteId) => void reviewComments.promoteNote?.(noteId)
                              : undefined
                          }
                          onSelectThread={handleSelectThread}
                          reviewPublish={reviewPublish}
                        />
                      </div>
                    ) : null}
                  </div>
                </Tabs.Panel>

                <Tabs.Panel className="min-h-0 flex-1" value="pull-request">
                  <PullRequestDetailsPanel
                    overview={pullRequestDetails.overview}
                    checks={pullRequestDetails.checks}
                    isOverviewLoading={pullRequestDetails.isOverviewLoading}
                    isChecksLoading={pullRequestDetails.isChecksLoading}
                    isChecksRefreshing={pullRequestDetails.isChecksRefreshing}
                    overviewError={pullRequestDetails.overviewError}
                    checksError={pullRequestDetails.checksError}
                    onRefreshChecks={pullRequestDetails.onRefreshChecks}
                  />
                </Tabs.Panel>
              </Tabs.Root>
            </div>
          ) : null}
        </div>
      </section>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            composerActions.dismissPendingComposerState();
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
                composerActions.applyPendingComposerState();
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
export type { PatchViewerMainProps, PullRequestDetailsState, RightSidebarTab };
