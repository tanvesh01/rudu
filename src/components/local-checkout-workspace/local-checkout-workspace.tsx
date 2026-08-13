import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowPathIcon } from "@heroicons/react/20/solid";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { useAppShellContext } from "../app-shell/app-shell-context";
import {
  DiffStyleToggle,
  LeftSidebarToggle,
  RightSidebarToggle,
} from "../ui/diff-style-toggle";
import { useDiffStyle } from "../../hooks/use-diff-style";
import {
  getCodeViewItemId,
  PatchCodeView,
  type PatchLineAnnotation,
} from "../patch-viewer/patch-code-view";
import { createPatchViewModel } from "../patch-viewer/patch-view-model";
import {
  createLineDraftTarget,
  getSelectedLineLabel,
  getThreadRefKey,
  type DraftReviewCommentTarget,
} from "../patch-viewer/review-composer-state";
import { ChangedFilesTree } from "../ui/changed-files-tree";
import { usePatchParsing } from "../../hooks/usePatchParsing";
import {
  buildLocalReviewThreads,
  buildLocalReviewThreadsByFile,
  type ReviewThread,
} from "../../lib/review-threads";
import {
  localCheckoutKeys,
  localCheckoutListQueryOptions,
  localCheckoutPatchQueryOptions,
  localCheckoutReviewNotesQueryOptions,
  localCheckoutStatusQueryOptions,
} from "../../queries/local-checkouts";
import type {
  LocalCheckout,
  LocalDiffSource,
} from "../../types/local-checkouts";
import {
  addUserReviewCommentDraft,
  addUserReviewNote,
  promoteReviewNote,
  publishReviewNotes,
  type ReviewNote,
  type SessionNavigation,
} from "../../queries/local-checkouts-native";
import { getErrorMessage } from "../../lib/get-error-message";
import { appToastManager } from "../../lib/toasts";
import { getLocalReviewScope } from "../../lib/local-review-scope";
import { ReviewCommentComposer } from "../ui/review-comment-composer";
import { ReviewThreadCard } from "../ui/review-thread-card";
import { ReviewNoteCard } from "../ui/review-note-card";
import { SUBMIT_COMMENT_SHORTCUT } from "../../lib/keyboard-shortcuts";
import { viewerLoginQueryOptions } from "../../queries/github";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

type LocalCheckoutWorkspaceProps = {
  checkoutId: string;
  source: LocalDiffSource | null;
};

function LocalCheckoutWorkspace({
  checkoutId,
  source,
}: LocalCheckoutWorkspaceProps) {
  const {
    finishSessionNavigation,
    isDark,
    isLeftSidebarOpen,
    sessionNavigation,
    toggleLeftSidebar,
  } = useAppShellContext();
  const queryClient = useQueryClient();
  const checkoutListQuery = useQuery(localCheckoutListQueryOptions());
  const statusQuery = useQuery(
    localCheckoutStatusQueryOptions(checkoutId, source ?? undefined),
  );
  const revision = statusQuery.data?.revision ?? "";
  const patchQuery = useQuery(
    localCheckoutPatchQueryOptions(checkoutId, revision, source ?? undefined),
  );
  const patch = patchQuery.data ?? null;
  const reviewScope = getLocalReviewScope(
    source,
    revision,
    patch?.revision ?? null,
    !patchQuery.isPlaceholderData,
  );
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [draftCommentTarget, setDraftCommentTarget] =
    useState<DraftReviewCommentTarget | null>(null);
  const [draftComposerState, setDraftComposerState] = useState({
    error: "",
    initialValue: "",
    isPending: false,
  });
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
  const handledNavigationRef = useRef<SessionNavigation | null>(null);
  const appWindow = getCurrentWindow();
  const [diffStyle, setDiffStyle] = useDiffStyle();
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const reviewNotesQuery = useQuery(
    localCheckoutReviewNotesQueryOptions(checkoutId, reviewScope),
  );
  // Scroll preservation across background refreshes: track the live scroll
  // offset and restore it after a new revision's items render.
  const scrollTopRef = useRef(0);
  const pendingScrollRestoreRef = useRef<number | null>(null);
  const restoredRevisionRef = useRef("");
  const checkout = checkoutListQuery.data?.find(
    (item) => item.id === checkoutId,
  );
  const status = statusQuery.data ?? null;
  const viewerLoginQuery = useQuery({
    ...viewerLoginQueryOptions(),
    enabled: status?.relatedPullRequest != null,
  });
  const viewerLogin = viewerLoginQuery.data?.login ?? null;
  const { parsedPatch } = usePatchParsing(
    patch
      ? {
          cacheKey: `local-${patch.checkoutId}-${patch.revision}`,
          patch: patch.patch,
        }
      : null,
  );
  const localThreads = useMemo(
    () => buildLocalReviewThreads(reviewNotesQuery.data, viewerLogin),
    [reviewNotesQuery.data, viewerLogin],
  );
  const notesThreads = useMemo(
    () => buildLocalReviewThreadsByFile(reviewNotesQuery.data, viewerLogin),
    [reviewNotesQuery.data, viewerLogin],
  );
  const privateNoteThreads = localThreads.filter(
    (thread) => thread.source === "note",
  );
  const commentDraftThreads = localThreads.filter(
    (thread) => thread.source === "comment-draft",
  );
  const draftCount =
    reviewNotesQuery.data?.filter(
      (note) => note.kind === "comment_draft" && note.replyToId === null,
    ).length ?? 0;
  const patchViewModel = useMemo(
    () =>
      createPatchViewModel({
        draftCommentTarget: reviewScope ? draftCommentTarget : null,
        fileDiffs: parsedPatch.fileDiffs,
        lineStats: null,
        reviewThreadsByFile: notesThreads,
      }),
    [draftCommentTarget, parsedPatch.fileDiffs, notesThreads, reviewScope],
  );

  // Mark the incoming revision for a scroll restore once its items land.
  useEffect(() => {
    const nextRevision = patch?.revision ?? "";
    if (!nextRevision || nextRevision === restoredRevisionRef.current) return;
    pendingScrollRestoreRef.current = scrollTopRef.current;
    restoredRevisionRef.current = nextRevision;
  }, [patch?.revision]);

  // After the new revision's items render, put the scroll offset back.
  useEffect(() => {
    const pending = pendingScrollRestoreRef.current;
    if (pending === null || parsedPatch.isParsing) return;
    const frame = requestAnimationFrame(() => {
      codeViewRef.current?.scrollTo({
        type: "position",
        position: pending,
        behavior: "instant",
      });
      pendingScrollRestoreRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [parsedPatch.isParsing, patchViewModel]);

  useEffect(() => {
    const changedFiles = status?.changedFiles ?? [];
    setSelectedFilePath((current) =>
      current && changedFiles.includes(current)
        ? current
        : (changedFiles[0] ?? null),
    );
  }, [status?.changedFiles]);

  useEffect(() => {
    if (!status) return;
    queryClient.setQueryData<LocalCheckout[]>(
      localCheckoutKeys.list(),
      (current) =>
        current?.map((item) =>
          item.id === checkoutId
            ? { ...item, branch: status.branch, available: true }
            : item,
        ),
    );
  }, [status, checkoutId, queryClient]);

  const selectFile = useCallback((path: string) => {
    setSelectedFilePath(path);
    const id = getCodeViewItemId(path);
    const codeView = codeViewRef.current;
    if (!codeView?.getItem(id)) return;
    codeView.scrollTo({
      type: "item",
      id,
      align: "start",
      behavior: "instant",
    });
  }, []);

  const selectThread = useCallback(
    (thread: ReviewThread) => {
      selectFile(thread.path);
      if (thread.line === null) return;

      codeViewRef.current?.scrollTo({
        type: "line",
        id: getCodeViewItemId(thread.path),
        lineNumber: thread.line,
        side: thread.side === "LEFT" ? "deletions" : "additions",
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
    [selectFile],
  );

  // Agent-driven navigation waits until the target diff item is rendered.
  useEffect(() => {
    if (
      !sessionNavigation ||
      handledNavigationRef.current === sessionNavigation ||
      sessionNavigation.target.kind !== "local_checkout" ||
      sessionNavigation.target.checkoutId !== checkoutId ||
      JSON.stringify(sessionNavigation.target.source) !== JSON.stringify(source) ||
      parsedPatch.isParsing
    ) {
      return;
    }
    const id = getCodeViewItemId(sessionNavigation.file);
    const codeView = codeViewRef.current;
    if (!codeView?.getItem(id)) return;

    handledNavigationRef.current = sessionNavigation;
    selectFile(sessionNavigation.file);
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
    checkoutId,
    finishSessionNavigation,
    parsedPatch.isParsing,
    patchViewModel,
    selectFile,
    sessionNavigation,
    source,
  ]);

  useEffect(() => {
    setDraftCommentTarget(null);
    setDraftComposerState({ error: "", initialValue: "", isPending: false });
  }, [checkoutId, reviewScope]);

  const openUserNoteDraft = useCallback(
    (path: string, range: Parameters<typeof createLineDraftTarget>[1]) => {
      const target = createLineDraftTarget(path, range);
      if (!target) return;
      setDraftCommentTarget(target);
      setDraftComposerState({ error: "", initialValue: "", isPending: false });
    },
    [],
  );

  const cancelUserNoteDraft = useCallback(() => {
    setDraftCommentTarget(null);
    setDraftComposerState({ error: "", initialValue: "", isPending: false });
  }, []);

  const submitUserAnnotation = useCallback(
    async (body: string, kind: "note" | "comment_draft") => {
      if (
        !reviewScope ||
        !draftCommentTarget ||
        draftCommentTarget.type !== "line"
      )
        return;

      setDraftComposerState({ error: "", initialValue: body, isPending: true });
      try {
        const note = await (kind === "note"
          ? addUserReviewNote
          : addUserReviewCommentDraft)({
          owner: { kind: "checkout", checkoutId },
          scope: reviewScope,
          filePath: draftCommentTarget.path,
          line: draftCommentTarget.line,
          side: draftCommentTarget.side === "LEFT" ? "deletions" : "additions",
          startLine: draftCommentTarget.startLine,
          startSide: draftCommentTarget.startSide
            ? draftCommentTarget.startSide === "LEFT"
              ? "deletions"
              : "additions"
            : null,
          body,
        });
        queryClient.setQueryData<ReviewNote[]>(
          localCheckoutKeys.reviewNotes(checkoutId, reviewScope),
          (current) => [...(current ?? []), note],
        );
        setDraftCommentTarget(null);
        setDraftComposerState({
          error: "",
          initialValue: "",
          isPending: false,
        });
      } catch (error) {
        setDraftComposerState({
          error: getErrorMessage(error),
          initialValue: body,
          isPending: false,
        });
      }
    },
    [checkoutId, draftCommentTarget, queryClient, reviewScope],
  );

  const promoteNote = useCallback(
    async (noteId: string) => {
      if (!reviewScope) return;
      try {
        const draft = await promoteReviewNote(
          { kind: "checkout", checkoutId },
          reviewScope,
          noteId,
        );
        queryClient.setQueryData<ReviewNote[]>(
          localCheckoutKeys.reviewNotes(checkoutId, reviewScope),
          (current) => [...(current ?? []), draft],
        );
      } catch (error) {
        appToastManager.add({
          title: "Could not create GitHub draft",
          description: getErrorMessage(error),
          type: "error",
        });
      }
    },
    [checkoutId, queryClient, reviewScope],
  );

  const publishDrafts = useCallback(async () => {
    if (!reviewScope || !status?.relatedPullRequest) return;
    setIsPublishing(true);
    try {
      const review = await publishReviewNotes(
        { kind: "checkout", checkoutId },
        reviewScope,
      );
      setIsPublishDialogOpen(false);
      await reviewNotesQuery.refetch();
      appToastManager.add({
        title: `Published ${review.publishedCount} draft${review.publishedCount === 1 ? "" : "s"}`,
        description: review.cleanupError ?? review.reviewUrl,
        type: review.cleanupError ? "error" : "success",
      });
    } catch (error) {
      appToastManager.add({
        title: "Could not publish drafts",
        description: getErrorMessage(error),
        type: "error",
      });
    } finally {
      setIsPublishing(false);
    }
  }, [checkoutId, reviewNotesQuery, reviewScope, status?.relatedPullRequest]);

  const refresh = useCallback(() => {
    void checkoutListQuery.refetch();
    void statusQuery.refetch();
    if (patchQuery.isEnabled) void patchQuery.refetch();
  }, [checkoutListQuery, patchQuery, statusQuery]);

  const handleDiffScroll = useCallback((scrollTop: number) => {
    scrollTopRef.current = scrollTop;
  }, []);

  const treeError = getErrorMessage(statusQuery.error);
  // Only surface a patch error when we have nothing to show; with
  // keepPreviousData a transient poll failure must not replace a good diff.
  const patchError = !patchQuery.data ? getErrorMessage(patchQuery.error) : "";
  const isTreeLoading = statusQuery.isPending;
  // First paint only: nothing parsed yet and no patch data in hand.
  const isPatchLoading = !patch && parsedPatch.isParsing;
  const isRefreshing =
    checkoutListQuery.isFetching ||
    statusQuery.isFetching ||
    patchQuery.isFetching;
  const hasChanges = Boolean(status && status.changedFiles.length > 0);

  const refreshButton = (
    <button
      aria-label="Refresh working changes"
      className="rounded p-1 text-ink-500 transition hover:bg-canvasDark hover:text-ink-700 disabled:opacity-50"
      disabled={isRefreshing}
      onClick={refresh}
      title="Refresh working changes"
      type="button"
    >
      <ArrowPathIcon
        className={["size-4", isRefreshing ? "animate-spin" : ""].join(" ")}
      />
    </button>
  );

  const tree = (
    <ChangedFilesTree
      emptyMessage={
        source ? "Selected diff has no changes." : "Working tree is clean."
      }
      error={treeError}
      files={status?.changedFiles ?? []}
      gitStatus={patchViewModel.gitStatus}
      reviewThreadsByFile={notesThreads}
      hasSelection
      headerAction={refreshButton}
      isDark={isDark}
      isLoading={isTreeLoading}
      onSelectFile={selectFile}
      selectedFilePath={selectedFilePath}
      showContainer={false}
      totals={patchViewModel.totals}
    />
  );

  if (!checkoutListQuery.isPending && !checkout) {
    return (
      <main className="flex h-full items-center justify-center bg-surface px-6 text-center text-danger-600">
        Local checkout not found.
      </main>
    );
  }

  return (
    <main className="h-full min-h-0 min-w-0 bg-surface">
      <section className="flex h-full min-h-0 min-w-0">
        <div className="relative flex min-h-0 min-w-[30%] flex-1 flex-col overflow-hidden">
          <div
            className={`flex h-10 shrink-0 items-center justify-between border-b border-ink-200/60 pr-2 ${isLeftSidebarOpen ? "pl-2" : "pl-20"}`}
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
          <div className="min-h-0 flex-1">
            {isPatchLoading ? (
              <WorkspaceMessage>Loading working changes...</WorkspaceMessage>
            ) : patchError ? (
              <WorkspaceMessage danger>{patchError}</WorkspaceMessage>
            ) : parsedPatch.parseError ? (
              <WorkspaceMessage danger>
                {parsedPatch.parseError}
              </WorkspaceMessage>
            ) : !hasChanges ? (
              <WorkspaceMessage>
                {source
                  ? "Selected diff has no changes."
                  : "Working tree is clean."}
              </WorkspaceMessage>
            ) : (
              <PatchCodeView
                codeViewRef={codeViewRef}
                draftCommentTarget={reviewScope ? draftCommentTarget : null}
                files={patchViewModel.files}
                isDark={isDark}
                onOpenLineCommentDraft={openUserNoteDraft}
                onScroll={handleDiffScroll}
                readOnly={!reviewScope}
                showReviewThreadSummary={false}
                renderReviewThreadAnnotations={(annotation) => {
                  if (
                    "kind" in annotation.metadata &&
                    annotation.metadata.kind === "draft"
                  ) {
                    return (
                      <ReviewCommentComposer
                        error={draftComposerState.error}
                        initialValue={draftComposerState.initialValue}
                        isPending={draftComposerState.isPending}
                        selectedLineLabel={getSelectedLineLabel(
                          draftCommentTarget,
                        )}
                        submitLabel="Save note"
                        secondaryAction={
                          status?.relatedPullRequest
                            ? {
                                label: "Draft comment",
                                shortcut: SUBMIT_COMMENT_SHORTCUT,
                                onSubmit: (body) =>
                                  submitUserAnnotation(body, "comment_draft"),
                              }
                            : undefined
                        }
                        onCancel={cancelUserNoteDraft}
                        onSubmit={(body) => submitUserAnnotation(body, "note")}
                      />
                    );
                  }

                  if (!("thread" in annotation.metadata)) return null;
                  const thread = annotation.metadata.thread;
                  return thread.source === "note" ? (
                    <ReviewNoteCard
                      compact
                      containerRef={(node) => setThreadCardRef(thread, node)}
                      onPromote={
                        status?.relatedPullRequest
                          ? (noteId) => void promoteNote(noteId)
                          : undefined
                      }
                      thread={thread}
                    />
                  ) : (
                    <ReviewThreadCard
                      compact
                      containerRef={(node) => setThreadCardRef(thread, node)}
                      thread={thread}
                    />
                  );
                }}
              />
            )}
          </div>
        </div>

        {isRightSidebarOpen ? (
          <div className="flex min-h-0 w-1/3 min-w-[15%] shrink-0 flex-col bg-surface">
            <div className="min-h-0 flex-1">{tree}</div>
            {localThreads.length > 0 ? (
              <div className="max-h-[45%] overflow-y-auto border-t border-ink-200 p-2">
                {privateNoteThreads.length > 0 ? (
                  <div className="mb-3 rounded-lg border border-amber-200/70 p-2 dark:border-amber-900/50">
                    <div className="mb-2 px-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                      Notes (private) ({privateNoteThreads.length})
                    </div>
                    <div className="flex flex-col gap-2">
                      {privateNoteThreads.map((thread) => (
                        <ReviewNoteCard
                          compact
                          key={thread.id}
                          onClick={() => selectThread(thread)}
                          onPromote={
                            status?.relatedPullRequest
                              ? (noteId) => void promoteNote(noteId)
                              : undefined
                          }
                          thread={thread}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {commentDraftThreads.length > 0 ? (
                  <div className="rounded-lg border border-blue-200/70 p-2 dark:border-blue-900/50">
                    <div className="mb-2 px-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                      Draft comments ({draftCount})
                    </div>
                    <div className="flex flex-col gap-2">
                      {commentDraftThreads.map((thread) => (
                        <ReviewThreadCard
                          key={thread.id}
                          onClick={() => selectThread(thread)}
                          slim
                          thread={thread}
                        />
                      ))}
                    </div>
                    {status?.relatedPullRequest ? (
                      <button
                        className="mt-3 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-default disabled:opacity-60"
                        disabled={isPublishing}
                        onClick={() => setIsPublishDialogOpen(true)}
                        type="button"
                      >
                        Post {draftCount} comment{draftCount === 1 ? "" : "s"} to GitHub
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
      <AlertDialog
        onOpenChange={setIsPublishDialogOpen}
        open={isPublishDialogOpen}
      >
        <AlertDialogContent className="p-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Publish review drafts?</AlertDialogTitle>
            <AlertDialogDescription>
              This posts {draftCount} comment{draftCount === 1 ? "" : "s"} to
              {" "}
              {status?.relatedPullRequest
                ? `${status.relatedPullRequest.repo}#${status.relatedPullRequest.number}`
                : "GitHub"}{" "}
              as one comment-only review. This cannot be undone in Rudu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPublishing} type="button">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isPublishing}
              onClick={() => void publishDrafts()}
              type="button"
            >
              {isPublishing ? "Publishing…" : "Publish to GitHub"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function WorkspaceMessage({
  children,
  danger = false,
}: {
  children: string;
  danger?: boolean;
}) {
  return (
    <div
      className={[
        "flex h-full items-center justify-center px-6 text-center text-sm",
        danger ? "text-danger-600" : "text-ink-500",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

export { LocalCheckoutWorkspace };
