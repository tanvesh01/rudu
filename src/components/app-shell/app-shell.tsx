import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWorkerPool } from "@pierre/diffs/react";
import { RepoSidebar } from "../ui/repo-sidebar";
import { RepoSidebarAccordion } from "../ui/repo-sidebar-accordion";
import { TrackPullRequestModal } from "../ui/track-pull-request-modal";
import {
  useSavedRepos,
  useTrackedPullRequests,
} from "../../hooks/useGithubQueries";
import { useAppShellWorkflow } from "../../hooks/useAppShellWorkflow";
import { useRepoOpenStore } from "../../stores";
import { useTrackedPullRequestRefreshCoordinator } from "../../hooks/useTrackedPullRequestRefreshCoordinator";
import { useTheme } from "../../hooks/use-theme";
import {
  getPullRequestIdentityKey,
  getPullRequestRouteParams,
  getSelectedPullRequestFromPathname,
  PULL_REQUEST_ROUTE,
} from "../../lib/pull-request-route";
import type { SelectedPullRequestRef } from "../../types/github";
import { OnboardingFlow, useOnboardingGate } from "../../features/onboarding";
import { buildRepositoryGroups } from "../../lib/repository-groups";
import { useLocalCheckoutWorkflow } from "../../hooks/useLocalCheckoutWorkflow";
import {
  completeSessionNavigation,
  installCliLauncher,
  takeCliLaunchRequest,
  takeSessionNavigation,
  type CliLaunchRequest,
  type SessionNavigation,
} from "../../queries/local-checkouts-native";
import { appToastManager } from "../../lib/toasts";
import { getErrorMessage } from "../../lib/get-error-message";
import {
  getLocalCheckoutRouteParams,
  LOCAL_CHECKOUT_ROUTE,
} from "../../lib/local-checkout-route";
import {
  AppShellContext,
  type AppShellContextValue,
} from "./app-shell-context";

function AppShell() {
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { isDark, toggleTheme } = useTheme();
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [sessionNavigations, setSessionNavigations] = useState<
    SessionNavigation[]
  >([]);
  const sessionNavigation = sessionNavigations[0] ?? null;
  const workerPool = useWorkerPool();
  const savedReposQuery = useSavedRepos();
  const { repos = [] } = savedReposQuery;
  const localCheckoutWorkflow = useLocalCheckoutWorkflow({ pathname });
  const localCheckouts = localCheckoutWorkflow.checkouts;
  const repositoryGroups = useMemo(
    () => buildRepositoryGroups(repos, localCheckouts),
    [localCheckouts, repos],
  );
  const { completeOnboarding, shouldShowOnboarding } = useOnboardingGate({
    isSavedReposPending:
      savedReposQuery.isPending || localCheckoutWorkflow.query.isPending,
    pathname,
    repoCount: repositoryGroups.length,
  });
  const selectedPr = useMemo(
    () => getSelectedPullRequestFromPathname(pathname),
    [pathname],
  );
  const selectedPrKey = getPullRequestIdentityKey(selectedPr);
  const selectedCheckoutId = localCheckoutWorkflow.selectedCheckoutId;
  const openRepoValues = useRepoOpenStore((state) => state.openRepoValues);
  const repoActions = useRepoOpenStore((state) => state.actions);

  const repoNames = useMemo(
    () => repositoryGroups.map((group) => group.key),
    [repositoryGroups],
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

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    let delivery = Promise.resolve();
    const openCheckout = async (request: CliLaunchRequest) => {
      const source = request.kind === "open_diff" ? request.source : undefined;
      const checkout = await localCheckoutWorkflow.addCheckoutPath(
        request.path,
        source,
      );
      if (!checkout) return;
      appToastManager.add({
        title: source
          ? `Opened selected diff in ${checkout.folderName}`
          : `Opened ${checkout.folderName}`,
        type: "info",
      });
    };
    const drainLaunches = () => {
      delivery = delivery.then(async () => {
        for (;;) {
          const request = await takeCliLaunchRequest();
          if (!request) return;
          await openCheckout(request);
        }
      });
    };

    void listen("rudu://cli-launch", drainLaunches).then((stop) => {
      if (disposed) stop();
      else {
        unlisten = stop;
        drainLaunches();
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [localCheckoutWorkflow.addCheckoutPath]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    let delivery = Promise.resolve();
    const drainNavigations = () => {
      delivery = delivery.then(async () => {
        const requests: SessionNavigation[] = [];
        for (;;) {
          const request = await takeSessionNavigation();
          if (!request) break;
          requests.push(request);
        }
        if (requests.length) {
          setSessionNavigations((current) => [...current, ...requests]);
        }
      });
    };

    void listen("rudu://session-navigate", drainNavigations).then((stop) => {
      if (disposed) stop();
      else {
        unlisten = stop;
        drainNavigations();
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!sessionNavigation) return;
    const params = getLocalCheckoutRouteParams(sessionNavigation.checkoutId);
    if (!params) {
      setSessionNavigations((current) => current.slice(1));
      return;
    }
    void navigate({ params, search: {}, to: LOCAL_CHECKOUT_ROUTE });
  }, [navigate, sessionNavigation]);

  const finishSessionNavigation = useCallback((request: SessionNavigation) => {
    void completeSessionNavigation(request.requestId)
      .catch(() => undefined)
      .finally(() => {
        setSessionNavigations((current) =>
          current[0] === request ? current.slice(1) : current,
        );
      });
  }, []);

  useEffect(() => {
    if (!sessionNavigation) return;
    // ponytail: release the GUI queue just after the server's 10s timeout;
    // add a cancellation event only if navigation timeouts need tuning.
    const timeout = window.setTimeout(() => {
      setSessionNavigations((current) =>
        current[0] === sessionNavigation ? current.slice(1) : current,
      );
    }, 11_000);
    return () => window.clearTimeout(timeout);
  }, [sessionNavigation]);

  async function handleInstallCliLauncher() {
    try {
      const path = await installCliLauncher();
      appToastManager.add({
        title: "Rudu command-line launcher installed",
        description: `Available at ${path}. Add ~/.local/bin to PATH if needed.`,
        type: "info",
      });
    } catch (error) {
      appToastManager.add({
        title: "Could not install the Rudu command-line launcher",
        description: getErrorMessage(error),
        type: "error",
      });
    }
  }

  function handleOnboardingComplete(
    firstTrackedPullRequest: SelectedPullRequestRef | null,
  ) {
    completeOnboarding();

    if (!firstTrackedPullRequest) return;

    const params = getPullRequestRouteParams(
      firstTrackedPullRequest.repo,
      firstTrackedPullRequest.number,
    );
    if (!params) return;

    void navigate({ params, to: PULL_REQUEST_ROUTE });
  }

  const shellContext = useMemo<AppShellContextValue>(
    () => ({
      finishSessionNavigation,
      isDark,
      isLeftSidebarOpen,
      sessionNavigation,
      refreshTrackedPullRequests,
      toggleLeftSidebar: () => setIsLeftSidebarOpen((open) => !open),
    }),
    [
      finishSessionNavigation,
      isDark,
      isLeftSidebarOpen,
      refreshTrackedPullRequests,
      sessionNavigation,
    ],
  );

  useEffect(() => {
    if (!workerPool) return;

    void workerPool.setRenderOptions({
      theme: isDark ? "pierre-dark" : "pierre-light",
    });
  }, [isDark, workerPool]);

  if (
    (savedReposQuery.isPending || localCheckoutWorkflow.query.isPending) &&
    pathname === "/"
  ) {
    return null;
  }

  if (shouldShowOnboarding) {
    return (
      <AppShellContext.Provider value={shellContext}>
        <div className="h-screen overflow-hidden bg-canvas text-ink-900">
          <OnboardingFlow
            savedRepos={repos}
            onComplete={handleOnboardingComplete}
          />
        </div>
      </AppShellContext.Provider>
    );
  }

  return (
    <AppShellContext.Provider value={shellContext}>
      <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink-900">
        <div className="flex min-h-0 flex-1">
          {isLeftSidebarOpen ? (
            <div className="min-h-0 w-1/4 min-w-[15%] shrink-0">
              <RepoSidebar
                isDark={isDark}
                onInstallCliLauncher={() => void handleInstallCliLauncher()}
                onToggleTheme={toggleTheme}
                onAddLocalCheckout={() =>
                  void localCheckoutWorkflow.addCheckout()
                }
              >
                <RepoSidebarAccordion
                  groups={repositoryGroups}
                  prsByRepo={prsByRepo}
                  repoErrors={repoErrors}
                  openValues={openRepoValues}
                  selectedCheckoutId={selectedCheckoutId}
                  selectedPrKey={selectedPrKey}
                  onSelectCheckout={localCheckoutWorkflow.selectCheckout}
                  onRemoveCheckout={(checkout) =>
                    void localCheckoutWorkflow.removeCheckout(checkout)
                  }
                  onSelectPr={(name, pr) =>
                    void workflow.handleSelectPr(name, pr)
                  }
                  onAddPr={(repo) =>
                    workflow.picker.openRepoPullRequestPicker(repo, repos)
                  }
                  onRemovePr={(repo, pullRequest) =>
                    void workflow.handleRemoveTrackedPullRequest(
                      repo,
                      pullRequest,
                    )
                  }
                  onRepoOpenChange={(repo, open) =>
                    void repoActions.repoAccordionToggled(repo, open)
                  }
                />
              </RepoSidebar>
            </div>
          ) : null}
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
          availableReposWarning={workflow.availableReposWarning}
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
