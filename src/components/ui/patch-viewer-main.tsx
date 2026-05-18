import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange,
} from "@pierre/diffs";
import { Virtualizer } from "@pierre/diffs/react";
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
import { ReviewChatPanel } from "../../features/review-chat";
import {
  addReviewChatAttachment,
  buildReviewLineSelection,
  createDiffLinesAttachment,
  getReviewChatAttachmentKey,
  hasReviewChatAttachment,
  type ReviewChatAttachment,
  type ReviewChatDiffLinesAttachment,
} from "../../features/review-chat/line-selection";
import { useDiffNavigator } from "../../hooks/use-diff-navigator";
import type { UseReviewSessionResult } from "../../hooks/useReviewSession";
import {
  FileDiffSection,
  type PatchLineAnnotation,
} from "../patch-viewer/patch-file-diff-section";
import {
  usePatchReviewComposerSession,
  type PatchReviewCommentApi,
} from "../patch-viewer/use-patch-review-composer-session";
import {
  type DraftReviewCommentTarget,
  getReplyComposerKey,
  getSelectedLineLabel,
  getThreadRefKey,
} from "../patch-viewer/review-composer-state";
import {
  isActiveReviewThread,
  type ReviewThread,
} from "../../lib/review-threads";
import type { PullRequestPanel } from "../../lib/pull-request-route";
import type {
  PullRequestChecks,
  PullRequestOverview,
  ReviewCommentSide,
} from "../../types/github";
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
  reviewSession: UseReviewSessionResult;
  latestHeadSha: string | null;
  isDark: boolean;
};

type RightSidebarTab = PullRequestPanel;

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

function toSelectionSide(side: ReviewCommentSide | null | undefined) {
  return side === "LEFT" ? "deletions" : "additions";
}

function getLineDraftRange(
  target: Extract<DraftReviewCommentTarget, { type: "line" }>,
): SelectedLineRange {
  return {
    start: target.startLine ?? target.line,
    side: toSelectionSide(target.startSide ?? target.side),
    end: target.line,
    endSide: toSelectionSide(target.side),
  };
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
  isReviewThreadsLoading,
  reviewThreadsError,
  parsedPatch,
  lineStats,
  rightSidebarTab,
  onRightSidebarTabChange,
  pullRequestDetails,
  reviewSession,
  latestHeadSha,
}: PatchViewerMainProps) {
  const appWindow = getCurrentWindow();
  const [chatAttachments, setChatAttachments] = useState<ReviewChatAttachment[]>(
    [],
  );
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
    activeComposerKey,
    draftCommentTarget,
    fileDiffs: parsedPatch.fileDiffs,
    lineStats,
    reviewThreads,
  });

  useEffect(() => {
    setChatAttachments([]);
  }, [selectedDiffKey]);

  const addChatAttachment = useCallback((attachment: ReviewChatAttachment) => {
    setChatAttachments((current) => addReviewChatAttachment(current, attachment));
  }, []);

  const removeChatAttachment = useCallback((attachmentId: string) => {
    setChatAttachments((current) =>
      current.filter(
        (attachment) => getReviewChatAttachmentKey(attachment) !== attachmentId,
      ),
    );
  }, []);

  const clearChatAttachments = useCallback(() => {
    setChatAttachments([]);
  }, []);

  function getDraftLineAttachment(
    target: DraftReviewCommentTarget | null,
  ): ReviewChatDiffLinesAttachment | null {
    if (!target || target.type !== "line") {
      return null;
    }

    const fileDiff = parsedPatch.fileDiffs.find(
      (fileDiff) => fileDiff.name === target.path,
    );
    if (!fileDiff) {
      return null;
    }

    const selection = buildReviewLineSelection(
      fileDiff,
      getLineDraftRange(target),
    );
    return selection ? createDiffLinesAttachment(selection) : null;
  }

  function getSelectedAttachmentRange(filePath: string): SelectedLineRange | null {
    const attachment = chatAttachments.find(
      (attachment) =>
        attachment.kind === "diff-lines" && attachment.path === filePath,
    );

    if (!attachment || attachment.kind !== "diff-lines") {
      return null;
    }

    return {
      start: attachment.startLine,
      side: attachment.startSide,
      end: attachment.endLine,
      endSide: attachment.endSide,
    };
  }

  function renderReviewThreadAnnotations(
    annotation: DiffLineAnnotation<PatchLineAnnotation>,
  ) {
    if ("kind" in annotation.metadata && annotation.metadata.kind === "draft") {
      const suggestionSeed =
        patchViewModel.getSuggestionSeedForDraftTarget(draftCommentTarget);
      const draftComposerState = getDraftComposerState(draftCommentTarget);
      const draftLineAttachment = getDraftLineAttachment(draftCommentTarget);
      const isDraftLineAttached = draftLineAttachment
        ? hasReviewChatAttachment(chatAttachments, draftLineAttachment)
        : false;

      return (
        <ReviewCommentComposer
          allowSuggestion={Boolean(suggestionSeed)}
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
          secondaryAction={
            draftLineAttachment
              ? {
                  disabled: isDraftLineAttached,
                  label: isDraftLineAttached
                    ? "Added to Rudu"
                    : "Add to Rudu",
                  onClick: () => addChatAttachment(draftLineAttachment),
                }
              : undefined
          }
          submitLabel="Comment"
          onCancel={stableCloseActiveComposer}
          onDirtyChange={stableSetActiveComposerDirty}
          onSubmit={stableSubmitDraftComment}
        />
      );
    }

    if (!("thread" in annotation.metadata)) {
      return null;
    }

    const threadAnnotation = annotation.metadata;
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
        onEditComment={stableEditComment}
        onReplyToThread={stableReplyToThread}
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
  const stableCancelDraftComment = useStableEvent(
    composerActions.cancelDraftComment,
  );
  const stableCloseActiveComposer = useStableEvent(
    composerActions.closeActiveComposer,
  );
  const stableSubmitDraftComment = useStableEvent(
    composerActions.submitDraftComment,
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
  const stableRemoveChatAttachment = useStableEvent(removeChatAttachment);
  const stableClearChatAttachments = useStableEvent(clearChatAttachments);

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
            <Virtualizer
              className="relative h-full min-h-0 min-w-0 overflow-y-auto scrollbar-hidden [overflow-anchor:none]"
              contentClassName="min-h-full"
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
                      {patchViewModel.files.map((patchViewFile) => {
                        const activeDraftTarget =
                          patchViewFile.fileDraft ?? patchViewFile.lineDraft;

                        return (
                          <FileDiffSection
                            key={`${selectedPatch.repo}-${selectedPatch.number}-${patchViewFile.normalizedPath}`}
                            draftComposerState={getDraftComposerState(
                              activeDraftTarget,
                            )}
                            fileDiff={patchViewFile.fileDiff}
                            fileDraft={patchViewFile.fileDraft}
                            fileLevelActiveComposerKey={
                              patchViewFile.fileLevelActiveComposerKey
                            }
                            fileReviewThreads={
                              patchViewFile.fileReviewThreads
                            }
                            getSuggestionSeedForThread={
                              patchViewModel.getSuggestionSeedForThread
                            }
                            lineDraft={patchViewFile.lineDraft}
                            selectedLineRange={getSelectedAttachmentRange(
                              patchViewFile.fileDiff.name,
                            )}
                            onActiveComposerDirtyChange={
                              stableSetActiveComposerDirty
                            }
                            onCancelDraftComment={stableCancelDraftComment}
                            onCloseActiveComposer={stableCloseActiveComposer}
                            onEditComment={stableEditComment}
                            onOpenLineCommentDraft={stableOpenLineCommentDraft}
                            onRegisterDiffNode={
                              navigator.diff.registerDiffNode
                            }
                            onSelectedLineRangeChange={() => {}}
                            onReplyToThread={stableReplyToThread}
                            getEditComposerState={
                              getEditComposerState
                            }
                            getReplyComposerState={
                              getReplyComposerState
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
            </Virtualizer>
          </div>
          <div className="min-h-0 w-1/3 min-w-[15%] shrink-0">
            <Tabs.Root
              className="flex h-full min-h-0 min-w-0 flex-col bg-surface"
              onValueChange={(value) => {
                onRightSidebarTabChange(value as RightSidebarTab);
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
                <Tabs.Tab
                  className="flex h-8 items-center justify-center border-0 px-2 text-sm font-normal whitespace-nowrap text-ink-500 outline-none select-none before:inset-x-0 before:inset-y-1 before:rounded-md before:-outline-offset-1 before:outline-brand-600 transition hover:text-ink-900 focus-visible:relative focus-visible:before:absolute focus-visible:before:outline focus-visible:before:outline-2 data-[active]:text-ink-900"
                  value="review-chat"
                >
                  Rudu
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
                      totals={patchViewModel.totals}
                      onSelectFile={navigator.tree.onSelectFile}
                      selectedFilePath={navigator.tree.selectedFilePath}
                      showContainer={false}
                      showHeader={false}
                      gitStatus={patchViewModel.gitStatus}
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

              <Tabs.Panel className="min-h-0 flex-1" value="review-chat">
                <ReviewChatPanel
                  isActive={rightSidebarTab === "review-chat"}
                  latestHeadSha={latestHeadSha}
                  attachments={chatAttachments}
                  onClearAttachments={stableClearChatAttachments}
                  onRemoveAttachment={stableRemoveChatAttachment}
                  reviewSession={reviewSession}
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
export type {
  PatchViewerMainProps,
  PullRequestDetailsState,
  RightSidebarTab,
};
