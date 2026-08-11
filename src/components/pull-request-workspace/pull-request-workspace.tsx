import { useState } from "react";
import { PatchViewerMain, type RightSidebarTab } from "../ui/patch-viewer-main";
import { useAppShellContext } from "../app-shell/app-shell-context";
import { usePatchParsing } from "../../hooks/usePatchParsing";
import { usePatchViewerLoadingToasts } from "../../hooks/usePatchViewerLoadingToasts";
import { usePullRequestDetails } from "../../hooks/usePullRequestDetails";
import { useReviewThreadWorkspace } from "../../hooks/useReviewThreadWorkspace";
import { useSelectedPullRequestWorkspace } from "../../hooks/useSelectedPullRequestWorkspace";
import { getErrorMessage } from "../../lib/get-error-message";
import { appToastManager } from "../../lib/toasts";
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
import { DEFAULT_PULL_REQUEST_PANEL } from "../../lib/pull-request-route";
import type { PullRequestPanel } from "../../lib/pull-request-route";
import type { SelectedPullRequestRef } from "../../types/github";

type PullRequestWorkspaceProps = {
  onRightSidebarTabChange?: (tab: PullRequestPanel) => void;
  rightSidebarTab?: PullRequestPanel;
  selectedPr: SelectedPullRequestRef | null;
};

function PullRequestWorkspace({
  onRightSidebarTabChange,
  rightSidebarTab,
  selectedPr,
}: PullRequestWorkspaceProps) {
  const { isDark, refreshTrackedPullRequests } = useAppShellContext();
  const [localRightSidebarTab, setLocalRightSidebarTab] =
    useState<RightSidebarTab>(DEFAULT_PULL_REQUEST_PANEL);
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  const activeRightSidebarTab = rightSidebarTab ?? localRightSidebarTab;
  const handleRightSidebarTabChange =
    onRightSidebarTabChange ?? setLocalRightSidebarTab;

  const selectedPullRequestWorkspace = useSelectedPullRequestWorkspace({
    selectedPr,
    refreshTrackedPullRequests,
  });

  const reviewThreadWorkspace = useReviewThreadWorkspace({
    selectedPr: selectedPullRequestWorkspace.data.selectedRevision,
  });

  const {
    data: {
      changedFiles,
      lineStats,
      selectedDiffKey,
      selectedPatch,
      selectedPrIdentityKey,
    },
    status: {
      changedFilesError,
      isDiffBundleLoading,
      patchError,
    },
  } = selectedPullRequestWorkspace;

  const {
    data: { draftCount, reviewThreads, reviewThreadsByFile },
    status: { isLoading: isReviewThreadsLoading, error: reviewThreadsError },
    actions: reviewCommentActions,
    flags: { isCreateCommentPending, isPublishPending },
    viewerLogin,
  } = reviewThreadWorkspace;

  const { parsedPatch } = usePatchParsing(
    selectedPatch
      ? {
          cacheKey: `${selectedPatch.repo}-${selectedPatch.number}-${selectedPatch.headSha}`,
          patch: selectedPatch.patch,
        }
      : null,
  );
  const isPatchPreparing = isDiffBundleLoading || parsedPatch.isParsing;
  const pullRequestDetails = usePullRequestDetails({
    isPullRequestPanelActive: activeRightSidebarTab === "pull-request",
    selectedPr,
    selectedRevision: selectedPullRequestWorkspace.data.selectedRevision,
  });
  usePatchViewerLoadingToasts({
    hasSelection: selectedPrIdentityKey !== null,
    isPatchLoading: isPatchPreparing,
    patchError,
    isReviewThreadsLoading,
  });

  async function publishDrafts() {
    try {
      const review = await reviewCommentActions.publishDrafts();
      setIsPublishDialogOpen(false);
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
    }
  }

  const publishAction =
    draftCount > 0 && selectedPullRequestWorkspace.data.selectedRevision ? (
      <button
        className="rounded-md bg-ink-900 px-2 py-1 text-sm font-medium text-white transition hover:bg-ink-700 disabled:cursor-default disabled:opacity-60 dark:bg-ink-200 dark:text-ink-900 dark:hover:bg-ink-300"
        disabled={isPublishPending}
        onClick={() => setIsPublishDialogOpen(true)}
        type="button"
      >
        Publish {draftCount}
      </button>
    ) : null;

  return (
    <>
      <PatchViewerMain
      selectedPrKey={selectedPrIdentityKey}
      selectedDiffKey={selectedDiffKey}
      selectedPatch={selectedPatch}
      isPatchLoading={isPatchPreparing}
      isDark={isDark}
      patchError={patchError}
      changedFiles={changedFiles}
      isChangedFilesLoading={isDiffBundleLoading}
      changedFilesError={changedFilesError}
      reviewComments={{
        createComment: reviewCommentActions.createComment,
        isCreateCommentPending,
        viewerLogin,
      }}
      reviewThreads={reviewThreads}
      reviewThreadsByFile={reviewThreadsByFile}
      isReviewThreadsLoading={isReviewThreadsLoading}
      reviewThreadsError={reviewThreadsError}
      parsedPatch={parsedPatch}
      lineStats={lineStats}
      rightSidebarTab={activeRightSidebarTab}
      onRightSidebarTabChange={handleRightSidebarTabChange}
        pullRequestDetails={pullRequestDetails}
        headerAction={publishAction}
      />
      <AlertDialog
        onOpenChange={setIsPublishDialogOpen}
        open={isPublishDialogOpen}
      >
        <AlertDialogContent className="p-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Publish review drafts?</AlertDialogTitle>
            <AlertDialogDescription>
              This posts {draftCount} comment{draftCount === 1 ? "" : "s"} to
              GitHub as one comment-only review. This cannot be undone in Rudu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPublishPending} type="button">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isPublishPending}
              onClick={() => void publishDrafts()}
              type="button"
            >
              {isPublishPending ? "Publishing…" : "Publish to GitHub"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export { PullRequestWorkspace };
export type { PullRequestWorkspaceProps };
