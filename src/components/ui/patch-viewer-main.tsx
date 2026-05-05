import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs } from "@base-ui/react/tabs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
} from "@pierre/diffs";
import type { GitStatusEntry } from "@pierre/trees";
import { ChangedFilesTree } from "./changed-files-tree";
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
import { PullRequestDetailsPanel } from "./pull-request-details-panel";
import { useDiffNavigator } from "../../hooks/use-diff-navigator";
import { isAdditionOnlyReviewRange } from "../../lib/review-suggestions";
import { getErrorMessage } from "../../hooks/useGithubQueries";
import {
  FileDiffSection,
  type PatchLineAnnotation,
} from "../patch-viewer/patch-file-diff-section";
import { getSuggestionSeedForLineRange } from "../patch-viewer/review-suggestion-seeds";
import {
  getFileLevelActiveComposerKey,
  getReplyComposerKey,
  getSelectedLineLabel,
  getThreadRefKey,
  usePatchReviewComposerSession,
  type DraftReviewCommentTarget,
} from "../patch-viewer/use-patch-review-composer-session";
import {
  getFileReviewThreadsForPath,
  isActiveReviewThread,
  normalizePath,
  type FileReviewThreads,
  type ReviewThread,
} from "../../lib/review-threads";
import {
  pullRequestChecksQueryOptions,
  pullRequestOverviewQueryOptions,
} from "../../queries/github";
import type {
  FileStatsEntry,
  PullRequestChecks,
  SelectedPullRequestRef,
} from "../../types/github";

const IDLE_PULL_REQUEST_REF: SelectedPullRequestRef = {
  repo: "__idle__",
  number: 0,
};

type SelectedPatch = {
  repo: string;
  number: number;
  headSha: string;
  patch: string;
};

type PatchViewerMainProps = {
  selectedPr: SelectedPullRequestRef | null;
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

type RightSidebarTab = "changed-files" | "pull-request";

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

function hasPendingChecks(checks: PullRequestChecks | undefined) {
  return Boolean(
    checks?.status === "pending" ||
      checks?.checks.some((check) => !check.isTerminal),
  );
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function useStableEvent<TArgs extends unknown[], TReturn>(
  callback: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  const callbackRef = useRef(callback);

  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  return useCallback(
    (...args: TArgs) => callbackRef.current(...args),
    [],
  );
}

type ReviewThreadsPanelProps = {
  threads: ReviewThread[];
  isLoading: boolean;
  error: string;
  hasSelection: boolean;
};

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
  selectedPr,
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
  const appWindow = getCurrentWindow();
  const [rightSidebarTab, setRightSidebarTab] =
    useState<RightSidebarTab>("changed-files");
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
  const selectedPrQueryRef = selectedPr ?? IDLE_PULL_REQUEST_REF;
  const pullRequestOverviewQuery = useQuery({
    ...pullRequestOverviewQueryOptions(selectedPrQueryRef),
    enabled: selectedPr !== null,
  });
  const pullRequestChecksQuery = useQuery({
    ...pullRequestChecksQueryOptions(selectedPrQueryRef),
    enabled: selectedPr !== null && rightSidebarTab === "pull-request",
    refetchInterval: (query) => {
      const checks = query.state.data as PullRequestChecks | undefined;
      return hasPendingChecks(checks) ? 5000 : false;
    },
  });

  function handleRefreshPullRequestChecks() {
    void pullRequestChecksQuery.refetch();
  }
  const changesTabTotals = useMemo(() => {
    if (lineStats) return lineStats;
    if (!fileStats) return null;

    let additions = 0;
    let deletions = 0;
    for (const entry of fileStats.values()) {
      additions += entry.additions;
      deletions += entry.deletions;
    }

    return { additions, deletions };
  }, [fileStats, lineStats]);
  const {
    activeComposerKey,
    draftCommentError,
    draftCommentInitialValue,
    draftCommentTarget,
    isCreateCommentPending,
    pendingComposerState,
    restoredEditBodies,
    restoredReplyBodies,
    viewerLogin,
    actions: composerActions,
  } = usePatchReviewComposerSession({
    selectedDiffKey,
    selectedPatch,
  });

  const fileDiffByPath = useMemo(
    () =>
      new Map(
        parsedPatch.fileDiffs.map((fileDiff) => [
          normalizePath(fileDiff.name),
          fileDiff,
        ]),
      ),
    [parsedPatch.fileDiffs],
  );

  function getSuggestionSeedForDraftTarget(
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
          initialValue={draftCommentInitialValue}
          isPending={isCreateCommentPending}
          selectedLineLabel={getSelectedLineLabel(draftCommentTarget)}
          suggestionLanguage={
            draftCommentTarget
              ? inferCodeLanguageFromPath(draftCommentTarget.path)
              : "text"
          }
          suggestionSeed={suggestionSeed}
          submitLabel="Comment"
          onCancel={() => {
            composerActions.clearDraftCommentError();
            composerActions.closeActiveComposer();
          }}
          onDirtyChange={composerActions.setActiveComposerDirty}
          onSubmit={composerActions.submitDraftComment}
        />
      );
    }

    if (!("thread" in annotation.metadata)) {
      return null;
    }

    const threadAnnotation = annotation.metadata;
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
        restoredEditBodies={restoredEditBodies}
        restoredReplyBody={
          restoredReplyBodies[threadAnnotation.thread.id] ?? ""
        }
        suggestionLanguage={inferCodeLanguageFromPath(
          threadAnnotation.thread.path,
        )}
        suggestionSeed={suggestionSeed}
        onComposerDirtyChange={composerActions.setActiveComposerDirty}
        onEditComment={composerActions.editComment}
        onReplyToThread={composerActions.replyToThread}
        onRestoredEditBodyChange={composerActions.setRestoredEditBody}
        onRestoredReplyBodyChange={(body) =>
          composerActions.setRestoredReplyBody(threadAnnotation.thread.id, body)
        }
        onRequestCloseComposer={composerActions.closeActiveComposer}
        onRequestEditComposer={composerActions.requestEditComposer}
        onRequestReplyComposer={composerActions.requestReplyComposer}
        thread={threadAnnotation.thread}
        viewerLogin={viewerLogin}
      />
    );
  }

  const stableOpenLineCommentDraft = useStableEvent(
    composerActions.openLineCommentDraft,
  );
  const stableCancelDraftComment = useStableEvent(
    composerActions.cancelDraftComment,
  );
  const stableCloseActiveComposer = useStableEvent(
    composerActions.closeActiveComposer,
  );
  const stableSubmitDraftComment = useStableEvent(
    composerActions.submitDraftComment,
  );
  const stableGetSuggestionSeedForThread = useStableEvent(
    getSuggestionSeedForThread,
  );
  const stableEditComment = useStableEvent(composerActions.editComment);
  const stableReplyToThread = useStableEvent(composerActions.replyToThread);
  const stableSetRestoredReplyBody = useStableEvent(
    composerActions.setRestoredReplyBody,
  );
  const stableSetRestoredEditBody = useStableEvent(
    composerActions.setRestoredEditBody,
  );
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
            <div
              className="relative h-full min-h-0 min-w-0 overflow-y-auto scrollbar-hidden [overflow-anchor:none]"
            >
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

                        const fileLevelActiveComposerKey =
                          getFileLevelActiveComposerKey(
                            activeComposerKey,
                            fileDraft,
                            fileReviewThreads.fileThreads,
                          );

                        return (
                          <FileDiffSection
                            key={`${selectedPatch.repo}-${selectedPatch.number}-${normalizePath(fileDiff.name)}`}
                            draftCommentError={draftCommentError}
                            draftCommentInitialValue={
                              draftCommentInitialValue
                            }
                            fileDiff={fileDiff}
                            fileDraft={fileDraft}
                            fileLevelActiveComposerKey={
                              fileLevelActiveComposerKey
                            }
                            fileReviewThreads={fileReviewThreads}
                            getSuggestionSeedForThread={
                              stableGetSuggestionSeedForThread
                            }
                            restoredEditBodies={restoredEditBodies}
                            restoredReplyBodies={restoredReplyBodies}
                            isCreateCommentPending={
                              isCreateCommentPending
                            }
                            lineDraft={lineDraft}
                            onActiveComposerDirtyChange={
                              composerActions.setActiveComposerDirty
                            }
                            onCancelDraftComment={stableCancelDraftComment}
                            onCloseActiveComposer={stableCloseActiveComposer}
                            onEditComment={stableEditComment}
                            onOpenLineCommentDraft={stableOpenLineCommentDraft}
                            onRegisterDiffNode={
                              navigator.diff.registerDiffNode
                            }
                            onReplyToThread={stableReplyToThread}
                            onRestoredEditBodyChange={
                              stableSetRestoredEditBody
                            }
                            onRestoredReplyBodyChange={
                              stableSetRestoredReplyBody
                            }
                            onRequestEditComposer={stableRequestEditComposer}
                            onRequestReplyComposer={stableRequestReplyComposer}
                            onSubmitDraftComment={stableSubmitDraftComment}
                            renderReviewThreadAnnotations={
                              renderReviewThreadAnnotations
                            }
                            viewerLogin={viewerLogin}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <div className="min-h-0 w-1/3 min-w-[15%] shrink-0">
            <Tabs.Root
              className="flex h-full min-h-0 min-w-0 flex-col bg-surface"
              onValueChange={(value) => {
                setRightSidebarTab(value as RightSidebarTab);
              }}
              value={rightSidebarTab}
            >
              <Tabs.List
                className="relative z-0 flex shrink-0 gap-1 bg-surface px-2 py-2"
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
                  {changesTabTotals ? (
                    <span className="ml-2 inline-flex items-center gap-1 font-mono text-xs font-bold">
                      <span className="text-emerald-600 dark:text-emerald-300">
                        +{formatCount(changesTabTotals.additions)}
                      </span>
                      <span className="text-red-500 dark:text-red-300">
                        −{formatCount(changesTabTotals.deletions)}
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
                  className="min-w-0 flex-1 cursor-grab active:cursor-grabbing"
                  data-tauri-drag-region
                  onMouseDown={(event) => {
                    if (event.button !== 0) return;
                    void appWindow.startDragging();
                  }}
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
                      lineStats={lineStats}
                      onSelectFile={navigator.tree.onSelectFile}
                      selectedFilePath={navigator.tree.selectedFilePath}
                      showContainer={false}
                      showHeader={false}
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
              </Tabs.Panel>

              <Tabs.Panel className="min-h-0 flex-1" value="pull-request">
                <PullRequestDetailsPanel
                  overview={pullRequestOverviewQuery.data ?? null}
                  checks={pullRequestChecksQuery.data ?? null}
                  isOverviewLoading={
                    pullRequestOverviewQuery.isPending ||
                    (pullRequestOverviewQuery.isFetching &&
                      !pullRequestOverviewQuery.data)
                  }
                  isChecksLoading={
                    pullRequestChecksQuery.isPending ||
                    (pullRequestChecksQuery.isFetching &&
                      !pullRequestChecksQuery.data)
                  }
                  isChecksRefreshing={pullRequestChecksQuery.isFetching}
                  overviewError={getErrorMessage(
                    pullRequestOverviewQuery.error,
                  )}
                  checksError={getErrorMessage(pullRequestChecksQuery.error)}
                  onRefreshChecks={handleRefreshPullRequestChecks}
                />
              </Tabs.Panel>
            </Tabs.Root>
          </div>
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
export type { PatchViewerMainProps };
