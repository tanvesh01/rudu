import { useEffect, useMemo } from "react";
import { Outlet, useLocation } from "@tanstack/react-router";
import { useWorkerPool } from "@pierre/diffs/react";
import { RepoSidebar } from "../ui/repo-sidebar";
import { IssuesNavButton } from "../ui/issues-nav-button";
import { RepoSidebarAccordion } from "../ui/repo-sidebar-accordion";
import { TrackPullRequestModal } from "../ui/track-pull-request-modal";
import {
  useIssueDashboard,
  useSavedRepos,
  useTrackedPullRequests,
} from "../../hooks/useGithubQueries";
import { useAppShellWorkflow } from "../../hooks/useAppShellWorkflow";
import { useRepoOpenStore } from "../../stores";
import { useTrackedPullRequestRefreshCoordinator } from "../../hooks/useTrackedPullRequestRefreshCoordinator";
import { useTheme } from "../../hooks/use-theme";
import {
  getPullRequestIdentityKey,
  getSelectedPullRequestFromPathname,
} from "../../lib/pull-request-route";
import {
  AppShellContext,
  type AppShellContextValue,
} from "./app-shell-context";

function AppShell() {
  const location = useLocation();
  const { isDark, toggleTheme } = useTheme();
  const workerPool = useWorkerPool();
  const { repos = [] } = useSavedRepos();
  const { count: openIssueCount } = useIssueDashboard();
  const selectedPr = getSelectedPullRequestFromPathname(location.pathname);
  const selectedPrKey = getPullRequestIdentityKey(selectedPr);
  const openRepoValues = useRepoOpenStore((state) => state.openRepoValues);
  const repoActions = useRepoOpenStore((state) => state.actions);

  const repoNames = useMemo(
    () => repos.map((repo) => repo.nameWithOwner),
    [repos],
  );

  useEffect(() => {
    useRepoOpenStore.getState().actions.syncRepos(repoNames);
  }, [repoNames]);

  const { prsByRepo, repoErrors, refreshTrackedPullRequests } =
    useTrackedPullRequests({
      repos,
    });
  const { refreshRepo } = useTrackedPullRequestRefreshCoordinator({
    repos,
    refreshTrackedPullRequests,
  });
  const workflow = useAppShellWorkflow({
    prsByRepo,
    refreshRepo,
    repos,
    selectedPr,
  });

  const shellContext = useMemo<AppShellContextValue>(
    () => ({
      isDark,
      refreshTrackedPullRequests,
    }),
    [isDark, refreshTrackedPullRequests],
  );

  useEffect(() => {
    if (!workerPool) return;

    void workerPool.setRenderOptions({
      theme: isDark ? "pierre-dark" : "pierre-light",
    });
  }, [isDark, workerPool]);

  return (
    <AppShellContext.Provider value={shellContext}>
      <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink-900">
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 w-1/4 min-w-[15%] shrink-0">
            <RepoSidebar
              isDark={isDark}
              onToggleTheme={toggleTheme}
              onAddRepo={workflow.picker.openRepoPicker}
            >
              <IssuesNavButton
                isActive={location.pathname === "/issues"}
                count={openIssueCount}
                onSelect={workflow.handleSelectIssues}
              />
              <RepoSidebarAccordion
                repos={repos}
                prsByRepo={prsByRepo}
                repoErrors={repoErrors}
                openValues={openRepoValues}
                selectedPrKey={selectedPrKey}
                onSelectPr={(name, pr) => void workflow.handleSelectPr(name, pr)}
                onAddPr={(repo) =>
                  workflow.picker.openRepoPullRequestPicker(repo, repos)
                }
                onRemovePr={(repo, pullRequest) =>
                  void workflow.handleRemoveTrackedPullRequest(repo, pullRequest)
                }
                onRepoOpenChange={(repo, open) =>
                  void repoActions.repoAccordionToggled(repo, open)
                }
              />
            </RepoSidebar>
          </div>
          <div className="min-h-0 min-w-[30%] flex-1">
            <Outlet />
          </div>
        </div>

        <TrackPullRequestModal
          open={workflow.picker.isPickerOpen}
          onOpenChange={workflow.handlePickerOpenChange}
          mode={workflow.picker.pickerMode}
          step={workflow.picker.pickerStep}
          selectedRepo={workflow.picker.pickerRepo}
          onSearchChange={workflow.picker.updateSearch}
          isLoadingRepos={workflow.isLoadingRepos}
          availableReposError={workflow.availableReposError}
          filteredRepos={workflow.filteredRepos}
          isSubmittingRepo={
            workflow.isSavingRepo || workflow.isOpeningPullRequestLink
          }
          manualRepoError={workflow.manualEntryError}
          onPickRepo={(repo) => void workflow.handlePickRepo(repo)}
          onSubmitManualRepo={(pullRequestLink) =>
            void workflow.handleSubmitPullRequestLink(pullRequestLink)
          }
          pullRequests={workflow.addablePullRequests}
          isLoadingPullRequests={workflow.picker.isLoadingPullRequests}
          pullRequestsError={workflow.picker.pickerPullRequestsError}
          isTrackingPullRequest={workflow.isTrackingPullRequest}
          onPickPullRequest={(pullRequest) =>
            void workflow.handleTrackPullRequest(pullRequest)
          }
          onBack={workflow.handlePickerBack}
        />
      </div>
    </AppShellContext.Provider>
  );
}

export { AppShell };
