import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowPathIcon,
  ChevronDoubleRightIcon,
  FolderOpenIcon,
} from "@heroicons/react/20/solid";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { useAppShellContext } from "../app-shell/app-shell-context";
import {
  getCodeViewItemId,
  PatchCodeView,
  type PatchLineAnnotation,
} from "../patch-viewer/patch-code-view";
import { createPatchViewModel } from "../patch-viewer/patch-view-model";
import { ChangedFilesTree } from "../ui/changed-files-tree";
import { usePatchParsing } from "../../hooks/usePatchParsing";
import type { FileReviewThreads } from "../../lib/review-threads";
import {
  localCheckoutKeys,
  localCheckoutListQueryOptions,
  localCheckoutPatchQueryOptions,
  localCheckoutStatusQueryOptions,
} from "../../queries/local-checkouts";
import type { LocalCheckout } from "../../types/local-checkouts";

type LocalCheckoutWorkspaceProps = {
  checkoutId: string;
};

const EMPTY_REVIEW_THREADS = new Map<string, FileReviewThreads>();

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
  const [isTreeVisible, setIsTreeVisible] = useState(true);
  const codeViewRef = useRef<CodeViewHandle<PatchLineAnnotation> | null>(null);
  const checkout = checkoutListQuery.data?.find((item) => item.id === checkoutId);
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
  const patchViewModel = useMemo(
    () =>
      createPatchViewModel({
        draftCommentTarget: null,
        fileDiffs: parsedPatch.fileDiffs,
        lineStats: null,
        reviewThreadsByFile: EMPTY_REVIEW_THREADS,
      }),
    [parsedPatch.fileDiffs],
  );

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

  const refresh = useCallback(() => {
    void checkoutListQuery.refetch();
    void statusQuery.refetch();
    if (patchQuery.isEnabled) void patchQuery.refetch();
  }, [checkoutListQuery, patchQuery, statusQuery]);

  const treeError =
    statusQuery.error instanceof Error ? statusQuery.error.message : "";
  const patchError =
    patchQuery.error instanceof Error ? patchQuery.error.message : "";
  const isTreeLoading = statusQuery.isPending;
  const isPatchLoading = patchQuery.isPending || parsedPatch.isParsing;
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

  const tree = (headerAction: React.ReactNode) => (
    <ChangedFilesTree
      emptyMessage="Working tree is clean."
      error={treeError}
      files={status?.changedFiles ?? []}
      gitStatus={patchViewModel.gitStatus}
      hasSelection
      headerAction={headerAction}
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
              draftChatAttachments={[]}
              draftCommentTarget={null}
              files={patchViewModel.files}
              onOpenLineCommentDraft={() => undefined}
              readOnly
              renderReviewThreadAnnotations={() => null}
            />
          )}

          {!isTreeVisible ? (
            <Popover.Root>
              <Popover.Trigger
                aria-label="Show changed files"
                className="absolute right-3 top-3 z-10 rounded-md bg-surface p-2 text-ink-500 shadow-sm outline outline-1 outline-ink-200 transition hover:bg-canvasDark hover:text-ink-700"
                title="Show changed files"
              >
                <FolderOpenIcon className="size-4" />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner align="end" sideOffset={8}>
                  <Popover.Popup className="h-[min(70vh,36rem)] w-96 overflow-hidden rounded-lg bg-surface shadow-xl outline outline-1 outline-ink-200">
                    {tree(refreshButton)}
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          ) : null}
        </div>

        {isTreeVisible ? (
          <div className="min-h-0 w-1/3 min-w-[15%] shrink-0 bg-surface">
            {tree(
              <>
                {refreshButton}
                <button
                  aria-label="Hide changed files"
                  className="rounded p-1 text-ink-500 transition hover:bg-canvasDark hover:text-ink-700"
                  onClick={() => setIsTreeVisible(false)}
                  title="Hide changed files"
                  type="button"
                >
                  <ChevronDoubleRightIcon className="size-4" />
                </button>
              </>,
            )}
          </div>
        ) : null}
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
