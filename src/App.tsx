import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useWorkerPool } from "@pierre/diffs/react";
import { Toast } from "@base-ui/react/toast";
import type { GitStatusEntry } from "@pierre/trees";
import { RepoSidebar } from "./components/ui/repo-sidebar";
import { TrackPullRequestModal } from "./components/ui/track-pull-request-modal";
import { PatchViewerMain } from "./components/ui/patch-viewer-main";
import { AppToastViewport } from "./components/ui/app-toast-viewport";
import {
  useRepoPickerRepos,
  useSavedRepos,
  useSelectedPullRequestData,
  useTrackedPullRequests,
} from "./hooks/useGithubQueries";
import { useGhCliStatusToasts } from "./hooks/useGhCliStatusToasts";
import { usePatchViewerLoadingToasts } from "./hooks/usePatchViewerLoadingToasts";
import { usePatchParsing } from "./hooks/usePatchParsing";
import { usePullRequestPicker } from "./hooks/usePullRequestPicker";
import { useRepoPrSelectionState } from "./hooks/useRepoPrSelectionState";
import { useTrackedPullRequestRefreshCoordinator } from "./hooks/useTrackedPullRequestRefreshCoordinator";
import { useTheme } from "./hooks/use-theme";
import { appToastManager } from "./lib/toasts";
import { buildReviewThreadsByFile } from "./lib/review-threads";
import {
  githubKeys,
  savedReposQueryOptions,
  upsertTrackedPullRequest,
} from "./queries/github";
import type {
  FileStatsEntry,
  PullRequestSummary,
  RepoSummary,
} from "./types/github";

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
    selectedPr,
    refreshTrackedPullRequests,
  });

  const picker = usePullRequestPicker();
  const { availableRepos, availableReposError, isLoadingRepos } =
    useRepoPickerRepos(
      picker.debouncedQuery,
      picker.isPickerOpen && picker.pickerStep === "repo",
    );

  const {
    changedFiles,
    changedFilesError,
    isDiffBundleLoading,
    isReviewThreadsLoading,
    lineStats,
    patchError,
    reviewThreads,
    reviewThreadsError,
    selectedDiffKey,
    selectedPatch,
    selectedPrIdentityKey,
  } = useSelectedPullRequestData(selectedPr);

  const { parsedPatch } = usePatchParsing(selectedPatch);

  const reviewThreadsByFile = useMemo(
    () => buildReviewThreadsByFile(reviewThreads),
    [reviewThreads],
  );

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

  const fileStats = useMemo(() => {
    if (parsedPatch.fileDiffs.length === 0) return null;
    const map = new Map<string, FileStatsEntry>();
    for (const fd of parsedPatch.fileDiffs) {
      const status: GitStatusEntry["status"] =
        fd.type === "new"
          ? "added"
          : fd.type === "deleted"
            ? "deleted"
            : "modified";
      map.set(fd.name, {
        additions: fd.additionLines.length,
        deletions: fd.deletionLines.length,
        status,
      });
    }
    return map;
  }, [parsedPatch.fileDiffs]);

  const gitStatus = useMemo(() => {
    if (!fileStats) return undefined;
    const entries: GitStatusEntry[] = [];
    for (const [path, entry] of fileStats) {
      entries.push({ path, status: entry.status });
    }
    return entries;
  }, [fileStats]);

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
      const savedRepo = await invoke<RepoSummary>("save_repo", { repo });
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
      const trackedPullRequest = await invoke<PullRequestSummary>(
        "track_pull_request",
        {
          repo: picker.pickerRepoName,
          pullRequest,
        },
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
    await invoke("remove_tracked_pull_request", {
      repo,
      number: pullRequest.number,
    });
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
            selectedPrKey={selectedPrIdentityKey}
            selectedDiffKey={selectedDiffKey}
            selectedPatch={selectedPatch}
            isPatchLoading={isPatchPreparing}
            isDark={isDark}
            patchError={patchError}
            changedFiles={changedFiles}
            isChangedFilesLoading={isDiffBundleLoading}
            changedFilesError={changedFilesError}
            reviewThreadsByFile={reviewThreadsByFile}
            reviewThreads={reviewThreads}
            isReviewThreadsLoading={isReviewThreadsLoading}
            reviewThreadsError={reviewThreadsError}
            parsedPatch={parsedPatch}
            fileStats={fileStats}
            gitStatus={gitStatus}
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
