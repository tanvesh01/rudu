import { useEffect } from "react";
import { useWorkerPool } from "@pierre/diffs/react";
import { Toast } from "@base-ui/react/toast";
import { RepoSidebar } from "./components/ui/repo-sidebar";
import { TrackPullRequestModal } from "./components/ui/track-pull-request-modal";
import { PatchViewerMain } from "./components/ui/patch-viewer-main";
import { AppToastViewport } from "./components/ui/app-toast-viewport";
import { useSavedRepos } from "./hooks/useGithubQueries";
import { useGhCliStatusToasts } from "./hooks/useGhCliStatusToasts";
import { usePatchViewerLoadingToasts } from "./hooks/usePatchViewerLoadingToasts";
import { usePatchParsing } from "./hooks/usePatchParsing";
import { useRepoPrSelectionState } from "./hooks/useRepoPrSelectionState";
import { useSelectedPullRequestWorkspace } from "./hooks/useSelectedPullRequestWorkspace";
import { useTrackedPullRequestWorkflow } from "./hooks/useTrackedPullRequestWorkflow";
import { useTrackedPullRequestRefreshCoordinator } from "./hooks/useTrackedPullRequestRefreshCoordinator";
import { useTheme } from "./hooks/use-theme";
import { appToastManager } from "./lib/toasts";
import type { PullRequestSummary } from "./types/github";

function MainApp() {
  const { isDark, toggleTheme } = useTheme();
  const workerPool = useWorkerPool();

  const { repos = [] } = useSavedRepos();
  const {
    selectedPr,
    setSelectedPr,
    openRepoValues,
    handleRepoOpenChange,
    handleSelectPr: baseHandleSelectPr,
  } = useRepoPrSelectionState({ repos });

  const trackedPullRequestWorkflow = useTrackedPullRequestWorkflow({
    repos,
    setSelectedPr,
  });
  const { prsByRepo, repoErrors, refreshTrackedPullRequests } =
    trackedPullRequestWorkflow;
  const { refreshRepo } = useTrackedPullRequestRefreshCoordinator({
    repos,
    refreshTrackedPullRequests,
  });

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

  useEffect(() => {
    if (!workerPool) return;

    void workerPool.setRenderOptions({
      theme: isDark ? "pierre-dark" : "pierre-light",
    });
  }, [isDark, workerPool]);

  function handleSelectPr(repo: string, pullRequest: PullRequestSummary) {
    baseHandleSelectPr(repo, pullRequest);
    void refreshRepo(repo);
  }

  const isPatchPreparing = isDiffBundleLoading || parsedPatch.isParsing;

  usePatchViewerLoadingToasts({
    hasSelection: selectedPrIdentityKey !== null,
    isPatchLoading: isPatchPreparing,
    patchError,
    isReviewThreadsLoading,
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink-900">
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 w-1/4 min-w-[15%] shrink-0">
          <RepoSidebar
            repos={repos}
            prsByRepo={prsByRepo}
            repoErrors={repoErrors}
            openValues={openRepoValues}
            selectedPrKey={selectedPrIdentityKey}
            isDark={isDark}
            onAddRepo={trackedPullRequestWorkflow.openRepoPicker}
            onAddPr={trackedPullRequestWorkflow.openRepoPullRequestPicker}
            onToggleTheme={toggleTheme}
            onSelectPr={(name, pr) => void handleSelectPr(name, pr)}
            onRemovePr={(repo, pullRequest) =>
              void trackedPullRequestWorkflow.removeTrackedPullRequest(
                repo,
                pullRequest,
              )
            }
            onRepoOpenChange={(repo, open) =>
              void handleRepoOpenChange(repo, open)
            }
          />
        </div>
        <div className="min-h-0 min-w-[30%] flex-1">
          <PatchViewerMain
            selectedPr={selectedPr}
            selectedRevision={selectedRevision}
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
          />
        </div>
      </div>

      <TrackPullRequestModal
        open={trackedPullRequestWorkflow.picker.open}
        onOpenChange={trackedPullRequestWorkflow.picker.onOpenChange}
        mode={trackedPullRequestWorkflow.picker.mode}
        step={trackedPullRequestWorkflow.picker.step}
        selectedRepo={trackedPullRequestWorkflow.picker.selectedRepo}
        onSearchChange={trackedPullRequestWorkflow.picker.onSearchChange}
        isLoadingRepos={trackedPullRequestWorkflow.picker.isLoadingRepos}
        availableReposError={
          trackedPullRequestWorkflow.picker.availableReposError
        }
        filteredRepos={trackedPullRequestWorkflow.picker.filteredRepos}
        isSubmittingRepo={trackedPullRequestWorkflow.picker.isSubmittingRepo}
        manualRepoError={trackedPullRequestWorkflow.picker.manualRepoError}
        onPickRepo={(repo) =>
          void trackedPullRequestWorkflow.picker.onPickRepo(repo)
        }
        onSubmitManualRepo={(pullRequestLink) =>
          void trackedPullRequestWorkflow.picker.onSubmitManualRepo(
            pullRequestLink,
          )
        }
        pullRequests={trackedPullRequestWorkflow.picker.pullRequests}
        isLoadingPullRequests={
          trackedPullRequestWorkflow.picker.isLoadingPullRequests
        }
        pullRequestsError={trackedPullRequestWorkflow.picker.pullRequestsError}
        isTrackingPullRequest={
          trackedPullRequestWorkflow.picker.isTrackingPullRequest
        }
        onPickPullRequest={(pullRequest) =>
          void trackedPullRequestWorkflow.picker.onPickPullRequest(pullRequest)
        }
        onBack={trackedPullRequestWorkflow.picker.onBack}
      />
    </div>
  );
}

function App() {
  useGhCliStatusToasts();

  return (
    <Toast.Provider toastManager={appToastManager}>
      <MainApp />
      <AppToastViewport />
    </Toast.Provider>
  );
}

export default App;
