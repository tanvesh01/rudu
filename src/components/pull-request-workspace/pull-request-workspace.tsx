import { useState } from "react";
import { PatchViewerMain, type RightSidebarTab } from "../ui/patch-viewer-main";
import { useAppShellContext } from "../app-shell/app-shell-context";
import { usePatchParsing } from "../../hooks/usePatchParsing";
import { usePatchViewerLoadingToasts } from "../../hooks/usePatchViewerLoadingToasts";
import { usePullRequestDetails } from "../../hooks/usePullRequestDetails";
import { useReviewThreadWorkspace } from "../../hooks/useReviewThreadWorkspace";
import { useSelectedPullRequestWorkspace } from "../../hooks/useSelectedPullRequestWorkspace";
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
    data: { reviewThreads, reviewThreadsByFile },
    status: { isLoading: isReviewThreadsLoading, error: reviewThreadsError },
    actions: reviewCommentActions,
    flags: { isCreateCommentPending },
    viewerLogin,
  } = reviewThreadWorkspace;

  const { parsedPatch } = usePatchParsing(selectedPatch);
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

  return (
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
        replyToComment: reviewCommentActions.replyToComment,
        updateComment: reviewCommentActions.updateComment,
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
    />
  );
}

export { PullRequestWorkspace };
export type { PullRequestWorkspaceProps };
