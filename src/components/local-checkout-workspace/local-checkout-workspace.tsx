import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowPathIcon } from "@heroicons/react/20/solid";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { useAppShellContext } from "../app-shell/app-shell-context";
import {
  getCodeViewItemId,
  PatchCodeView,
  type PatchLineAnnotation,
} from "../patch-viewer/patch-code-view";
import { createPatchViewModel } from "../patch-viewer/patch-view-model";
import {
  createLineDraftTarget,
  getSelectedLineLabel,
  type DraftReviewCommentTarget,
} from "../patch-viewer/review-composer-state";
import { ChangedFilesTree } from "../ui/changed-files-tree";
import { usePatchParsing } from "../../hooks/usePatchParsing";
import type { FileReviewThreads } from "../../lib/review-threads";
import {
  localCheckoutKeys,
  localCheckoutListQueryOptions,
  localCheckoutPatchQueryOptions,
  localCheckoutReviewNotesQueryOptions,
  localCheckoutStatusQueryOptions,
} from "../../queries/local-checkouts";
import { listen } from "@tauri-apps/api/event";
import type { LocalCheckout } from "../../types/local-checkouts";
import {
  addUserReviewNote,
  type ReviewNote,
} from "../../queries/local-checkouts-native";
import { getErrorMessage } from "../../lib/get-error-message";
import { ReviewCommentComposer } from "../ui/review-comment-composer";
import { ReviewThreadCard } from "../ui/review-thread-card";

type LocalCheckoutWorkspaceProps = {
  checkoutId: string;
};

function notesToReviewThreads(notes: ReviewNote[] | undefined) {
  const byFile = new Map<string, FileReviewThreads>();
  for (const note of notes ?? []) {
    const entry = byFile.get(note.filePath) ?? {
      fileThreads: [],
      lineAnnotations: [],
      totalCount: 0,
      unresolvedCount: 0,
    };
    entry.lineAnnotations.push({
      side: note.side,
      lineNumber: note.line,
      metadata: {
        thread: {
          id: note.id,
          path: note.filePath,
          isResolved: false,
          isOutdated: false,
          line: note.line,
          startLine: note.startLine,
          side: note.side === "additions" ? "RIGHT" : "LEFT",
          startSide: note.startSide
            ? note.startSide === "additions"
              ? "RIGHT"
              : "LEFT"
            : null,
          subjectType: "line",
          comments: [
            {
              id: note.id,
              databaseId: null,
              authorLogin: note.author === "agent" ? "agent" : "you",
              authorAvatarUrl: null,
              authorAssociation: note.author === "agent" ? "AGENT" : "USER",
              body: note.body,
              createdAt: new Date(note.createdAt * 1000).toISOString(),
              updatedAt: new Date(note.createdAt * 1000).toISOString(),
              url: "",
              replyToId: null,
            },
          ],
        },
      },
    });
    entry.totalCount += 1;
    entry.unresolvedCount += 1;
    byFile.set(note.filePath, entry);
  }
  return byFile;
}

function LocalCheckoutWorkspace({ checkoutId }: LocalCheckoutWorkspaceProps) {
  const { isDark } = useAppShellContext();
  const queryClient = useQueryClient();
  const checkoutListQuery = useQuery(localCheckoutListQueryOptions());
  const statusQuery = useQuery(localCheckoutStatusQueryOptions(checkoutId));
  const revision = statusQuery.data?.revision ?? "";
  const patchQuery = useQuery(
    localCheckoutPatchQueryOptions(checkoutId, revision),
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
  const reviewNotesQuery = useQuery(
    localCheckoutReviewNotesQueryOptions(checkoutId),
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
  const patch = patchQuery.data ?? null;
  const { parsedPatch } = usePatchParsing(
    patch
      ? {
          cacheKey: `local-${patch.checkoutId}-${patch.revision}`,
          patch: patch.patch,
        }
      : null,
  );
  const notesThreads = useMemo(
    () => notesToReviewThreads(reviewNotesQuery.data),
    [reviewNotesQuery.data],
  );
  const patchViewModel = useMemo(
    () =>
      createPatchViewModel({
        draftCommentTarget,
        fileDiffs: parsedPatch.fileDiffs,
        lineStats: null,
        reviewThreadsByFile: notesThreads,
      }),
    [draftCommentTarget, parsedPatch.fileDiffs, notesThreads],
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

  // Agent-driven navigation from `rudu session navigate`.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<{
      checkoutId: string;
      file: string;
      line: number;
      side: "additions" | "deletions";
    }>("rudu://session-navigate", ({ payload }) => {
      if (payload.checkoutId !== checkoutId) return;
      selectFile(payload.file);
      codeViewRef.current?.scrollTo({
        type: "line",
        id: getCodeViewItemId(payload.file),
        lineNumber: payload.line,
        side: payload.side,
        align: "center",
        behavior: "instant",
      });
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [checkoutId, selectFile]);

  useEffect(() => {
    setDraftCommentTarget(null);
    setDraftComposerState({ error: "", initialValue: "", isPending: false });
  }, [checkoutId]);

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

  const submitUserNote = useCallback(
    async (body: string) => {
      if (!draftCommentTarget || draftCommentTarget.type !== "line") return;

      setDraftComposerState({ error: "", initialValue: body, isPending: true });
      try {
        const note = await addUserReviewNote({
          checkoutId,
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
          localCheckoutKeys.reviewNotes(checkoutId),
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
    [checkoutId, draftCommentTarget, queryClient],
  );

  const refresh = useCallback(() => {
    void checkoutListQuery.refetch();
    void statusQuery.refetch();
    if (patchQuery.isEnabled) void patchQuery.refetch();
  }, [checkoutListQuery, patchQuery, statusQuery]);

  const handleDiffScroll = useCallback((scrollTop: number) => {
    scrollTopRef.current = scrollTop;
  }, []);

  const treeError =
    statusQuery.error instanceof Error ? statusQuery.error.message : "";
  // Only surface a patch error when we have nothing to show; with
  // keepPreviousData a transient poll failure must not replace a good diff.
  const patchError =
    !patchQuery.data && patchQuery.error instanceof Error
      ? patchQuery.error.message
      : "";
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
      emptyMessage="Working tree is clean."
      error={treeError}
      files={status?.changedFiles ?? []}
      gitStatus={patchViewModel.gitStatus}
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
        <div className="relative min-h-0 min-w-[30%] flex-1 overflow-hidden">
          {isPatchLoading ? (
            <WorkspaceMessage>Loading working changes...</WorkspaceMessage>
          ) : patchError ? (
            <WorkspaceMessage danger>{patchError}</WorkspaceMessage>
          ) : parsedPatch.parseError ? (
            <WorkspaceMessage danger>{parsedPatch.parseError}</WorkspaceMessage>
          ) : !hasChanges ? (
            <WorkspaceMessage>Working tree is clean.</WorkspaceMessage>
          ) : (
            <PatchCodeView
              codeViewRef={codeViewRef}
              draftCommentTarget={draftCommentTarget}
              files={patchViewModel.files}
              onOpenLineCommentDraft={openUserNoteDraft}
              onScroll={handleDiffScroll}
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
                      submitLabel="Add note"
                      onCancel={cancelUserNoteDraft}
                      onSubmit={submitUserNote}
                    />
                  );
                }

                if (!("thread" in annotation.metadata)) return null;
                return (
                  <ReviewThreadCard
                    compact
                    thread={annotation.metadata.thread}
                  />
                );
              }}
            />
          )}
        </div>

        <div className="min-h-0 w-1/3 min-w-[15%] shrink-0 bg-surface">
          {tree}
        </div>
      </section>
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
