import { useState } from "react";
import { PatchViewerMain, type RightSidebarTab } from "../ui/patch-viewer-main";
import { useAppShellContext } from "../app-shell/app-shell-context";
import { usePatchParsing } from "../../hooks/usePatchParsing";
import { usePatchViewerLoadingToasts } from "../../hooks/usePatchViewerLoadingToasts";
import { usePullRequestDetails } from "../../hooks/usePullRequestDetails";
import { useReviewSession } from "../../hooks/useReviewSession";
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
  const {
    data: {
      changedFiles,
      lineStats,
      reviewThreads,
      selectedDiffKey,
      selectedPatch,
      selectedPrIdentityKey,
      selectedRevision,
    },
    status: {
      changedFilesError,
      isDiffBundleLoading,
      isReviewThreadsLoading,
      patchError,
      reviewThreadsError,
    },
    reviewComments,
  } = selectedPullRequestWorkspace;
  const { parsedPatch } = usePatchParsing(selectedPatch);
  const isPatchPreparing = isDiffBundleLoading || parsedPatch.isParsing;
  const pullRequestDetails = usePullRequestDetails({
    isPullRequestPanelActive: activeRightSidebarTab === "pull-request",
    selectedPr,
    selectedRevision,
  });
  const reviewSession = useReviewSession(selectedRevision, {
    enabled: activeRightSidebarTab === "review-chat",
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
      reviewComments={reviewComments}
      reviewThreads={reviewThreads}
      isReviewThreadsLoading={isReviewThreadsLoading}
      reviewThreadsError={reviewThreadsError}
      parsedPatch={parsedPatch}
      lineStats={lineStats}
      rightSidebarTab={activeRightSidebarTab}
      onRightSidebarTabChange={handleRightSidebarTabChange}
      pullRequestDetails={pullRequestDetails}
      reviewSession={reviewSession}
      latestHeadSha={selectedRevision?.headSha ?? null}
    />
  );
}

export { PullRequestWorkspace };
export type { PullRequestWorkspaceProps };
