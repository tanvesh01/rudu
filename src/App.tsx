import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkerPool } from "@pierre/diffs/react";
import { Toast } from "@base-ui/react/toast";
import { RepoSidebar } from "./components/ui/repo-sidebar";
import { TrackPullRequestModal } from "./components/ui/track-pull-request-modal";
import { PatchViewerMain } from "./components/ui/patch-viewer-main";
import { AppToastViewport } from "./components/ui/app-toast-viewport";
import {
  useRepoPickerRepos,
  useSavedRepos,
  useTrackedPullRequests,
} from "./hooks/useGithubQueries";
import { useGhCliStatusToasts } from "./hooks/useGhCliStatusToasts";
import { usePatchViewerLoadingToasts } from "./hooks/usePatchViewerLoadingToasts";
import { usePatchParsing } from "./hooks/usePatchParsing";
import { usePullRequestPicker } from "./hooks/usePullRequestPicker";
import { useRepoPrSelectionState } from "./hooks/useRepoPrSelectionState";
import { useSelectedPullRequestWorkspace } from "./hooks/useSelectedPullRequestWorkspace";
import { useTrackedPullRequestRefreshCoordinator } from "./hooks/useTrackedPullRequestRefreshCoordinator";
import { useTheme } from "./hooks/use-theme";
import { appToastManager } from "./lib/toasts";
import {
  githubKeys,
  savedReposQueryOptions,
  upsertTrackedPullRequest,
} from "./queries/github";
import {
  removeTrackedPullRequest,
  saveRepo,
  trackPullRequest,
} from "./queries/github-native";
import type { PullRequestSummary, RepoSummary } from "./types/github";

function MainApp() {
  const queryClient = useQueryClient();
  const { isDark, toggleTheme } = useTheme();
  const workerPool = useWorkerPool();
  const [isSavingRepo, setIsSavingRepo] = useState(false);
  const [isTrackingPullRequest, setIsTrackingPullRequest] = useState(false);

  const { repos = [] } = useSavedRepos();
  const {
    selectedPr,
    setSelectedPr,
    openRepoValues,
    handleRepoOpenChange,
    handleSelectPr: baseHandleSelectPr,
  } = useRepoPrSelectionState({ repos });

  const { prsByRepo, repoErrors, refreshTrackedPullRequests } =
    useTrackedPullRequests({
      repos,
    });
  const { refreshRepo } = useTrackedPullRequestRefreshCoordinator({
    repos,
    refreshTrackedPullRequests,
  });

  const picker = usePullRequestPicker();
  const { availableRepos, availableReposError, isLoadingRepos } =
    useRepoPickerRepos(
      picker.debouncedQuery,
      picker.isPickerOpen && picker.pickerStep === "repo",
    );

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

  const addedRepoKeys = useMemo(
    () => new Set(repos.map((r) => r.nameWithOwner)),
    [repos],
  );

  const filteredRepos = useMemo(
    () => {
      const addableRepos = availableRepos.filter(
        (r) => !addedRepoKeys.has(r.nameWithOwner),
      );

      return picker.debouncedQuery.trim().length === 0
        ? addableRepos.slice(0, 6)
        : addableRepos;
    },
    [availableRepos, addedRepoKeys, picker.debouncedQuery],
  );

  const trackedPrNumbersForPicker = useMemo(() => {
    if (!picker.pickerRepoName) return new Set<number>();
    const trackedPullRequests = prsByRepo[picker.pickerRepoName] ?? [];
    return new Set(trackedPullRequests.map((pr) => pr.number));
  }, [picker.pickerRepoName, prsByRepo]);

  const addablePullRequests = useMemo(
    () =>
      picker.pickerOpenPullRequests.filter(
        (pr) => !trackedPrNumbersForPicker.has(pr.number),
      ),
    [picker.pickerOpenPullRequests, trackedPrNumbersForPicker],
  );

  async function handlePickRepo(repo: RepoSummary) {
    setIsSavingRepo(true);
    try {
      const savedRepo = await saveRepo(repo);
      queryClient.setQueryData<RepoSummary[]>(
        savedReposQueryOptions().queryKey,
        (current) => {
          if (!current) return [savedRepo];
          if (
            current.some(
              (item) => item.nameWithOwner === savedRepo.nameWithOwner,
            )
          ) {
            return current;
          }
          return [...current, savedRepo];
        },
      );

      picker.setPickerRepo(savedRepo);
      picker.setPickerStep("pull-request");
    } finally {
      setIsSavingRepo(false);
    }
  }

  async function handleTrackPullRequest(pullRequest: PullRequestSummary) {
    if (!picker.pickerRepoName) return;

    setIsTrackingPullRequest(true);
    try {
      const trackedPullRequest = await trackPullRequest(
        picker.pickerRepoName,
        pullRequest,
      );
      queryClient.setQueryData<PullRequestSummary[]>(
        githubKeys.trackedPullRequestList(picker.pickerRepoName),
        (current) => upsertTrackedPullRequest(current, trackedPullRequest),
      );

      setSelectedPr({
        repo: picker.pickerRepoName,
        number: trackedPullRequest.number,
      });
      picker.setIsPickerOpen(false);
      picker.resetPickerState();
    } finally {
      setIsTrackingPullRequest(false);
    }
  }

  async function handleRemoveTrackedPullRequest(
    repo: string,
    pullRequest: PullRequestSummary,
  ) {
    await removeTrackedPullRequest(repo, pullRequest.number);
    queryClient.setQueryData<PullRequestSummary[]>(
      githubKeys.trackedPullRequestList(repo),
      (current) =>
        (current ?? []).filter((item) => item.number !== pullRequest.number),
    );

    setSelectedPr((current) => {
      if (!current) return current;
      if (current.repo !== repo || current.number !== pullRequest.number) {
        return current;
      }
      return null;
    });
  }

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
            onAddRepo={picker.openRepoPicker}
            onAddPr={(repo) => picker.openRepoPullRequestPicker(repo, repos)}
            onToggleTheme={toggleTheme}
            onSelectPr={(name, pr) => void handleSelectPr(name, pr)}
            onRemovePr={(repo, pullRequest) =>
              void handleRemoveTrackedPullRequest(repo, pullRequest)
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
        open={picker.isPickerOpen}
        onOpenChange={(open) => {
          picker.setIsPickerOpen(open);
          if (!open) {
            picker.resetPickerState();
          }
        }}
        mode={picker.pickerMode}
        step={picker.pickerStep}
        selectedRepo={picker.pickerRepo}
        onSearchChange={picker.updateSearch}
        isLoadingRepos={isLoadingRepos}
        availableReposError={availableReposError}
        filteredRepos={filteredRepos}
        isSavingRepo={isSavingRepo}
        onPickRepo={(repo) => void handlePickRepo(repo)}
        pullRequests={addablePullRequests}
        isLoadingPullRequests={picker.isLoadingPullRequests}
        pullRequestsError={picker.pickerPullRequestsError}
        isTrackingPullRequest={isTrackingPullRequest}
        onPickPullRequest={(pullRequest) =>
          void handleTrackPullRequest(pullRequest)
        }
        onBack={() => {
          picker.setPickerStep("repo");
          picker.setPickerRepo(null);
        }}
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
