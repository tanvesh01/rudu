import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWorkerPool } from "@pierre/diffs/react";
import { TrackPullRequestModal } from "../ui/track-pull-request-modal";
import { useSavedRepos } from "../../hooks/useGithubQueries";
import { useAppShellWorkflow } from "../../hooks/useAppShellWorkflow";
import { useTheme } from "../../hooks/use-theme";
import {
  getPullRequestRouteParams,
  getSelectedPullRequestFromPathname,
  PULL_REQUEST_ROUTE,
} from "../../lib/pull-request-route";
import type { SelectedPullRequestRef } from "../../types/github";
import { OnboardingFlow, useOnboardingGate } from "../../features/onboarding";
import { useLocalCheckoutWorkflow } from "../../hooks/useLocalCheckoutWorkflow";
import {
  completeSessionNavigation,
  installCliLauncher,
  setActiveSessionTarget,
  takeCliLaunchRequest,
  takeSessionNavigation,
  type CliLaunchRequest,
  type SessionNavigation,
} from "../../queries/local-checkouts-native";
import { appToastManager } from "../../lib/toasts";
import { getErrorMessage } from "../../lib/get-error-message";
import {
  getLocalCheckoutRouteParams,
  getLocalDiffSourceSearch,
  LOCAL_CHECKOUT_ROUTE,
  parseLocalDiffSource,
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
  const localDiffSearch = useRouterState({
    select: (state) => {
      const diff = (state.location.search as { diff?: unknown }).diff;
      return typeof diff === "string" ? diff : undefined;
    },
  });
  const { isDark, toggleTheme } = useTheme();
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [sessionNavigations, setSessionNavigations] = useState<
    SessionNavigation[]
  >([]);
  const sessionNavigation = sessionNavigations[0] ?? null;
  const workerPool = useWorkerPool();
  const savedReposQuery = useSavedRepos();
  const { repos = [] } = savedReposQuery;
  const localCheckoutWorkflow = useLocalCheckoutWorkflow({ pathname });
  const { completeOnboarding, shouldShowOnboarding } = useOnboardingGate({
    isSavedReposPending:
      savedReposQuery.isPending || localCheckoutWorkflow.query.isPending,
    pathname: pathname === "/pulls" ? "/" : pathname,
    repoCount: repos.length + localCheckoutWorkflow.checkouts.length,
  });
  const selectedPr = useMemo(
    () => getSelectedPullRequestFromPathname(pathname),
    [pathname],
  );
  const selectedCheckoutId = localCheckoutWorkflow.selectedCheckoutId;
  const selectedLocalDiffSource = useMemo(
    () => parseLocalDiffSource(localDiffSearch),
    [localDiffSearch],
  );
  const workflow = useAppShellWorkflow({ repos });

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    let delivery = Promise.resolve();
    const openLaunch = async (request: CliLaunchRequest) => {
      if (request.kind === "open_pull_request") {
        try {
          await workflow.openPullRequest(request.repo, request.number);
        } catch (error) {
          appToastManager.add({
            title: "Could not open pull request",
            description: getErrorMessage(error),
            type: "error",
          });
        }
        return;
      }

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
          await openLaunch(request);
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
  }, [localCheckoutWorkflow.addCheckoutPath, workflow.openPullRequest]);

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
    const target = selectedPr
      ? {
          kind: "pull_request" as const,
          repo: selectedPr.repo,
          number: selectedPr.number,
        }
      : selectedCheckoutId
        ? {
            kind: "local_checkout" as const,
            checkoutId: selectedCheckoutId,
            source: selectedLocalDiffSource,
          }
        : null;
    void setActiveSessionTarget(target);
  }, [selectedCheckoutId, selectedLocalDiffSource, selectedPr]);

  useEffect(() => {
    if (!sessionNavigation) return;
    const { target } = sessionNavigation;
    if (target.kind === "pull_request") {
      const params = getPullRequestRouteParams(target.repo, target.number);
      if (params) void navigate({ params, to: PULL_REQUEST_ROUTE });
      else setSessionNavigations((current) => current.slice(1));
      return;
    }

    const params = getLocalCheckoutRouteParams(target.checkoutId);
    if (!params) {
      setSessionNavigations((current) => current.slice(1));
      return;
    }
    void navigate({
      params,
      search: getLocalDiffSourceSearch(target.source ?? undefined),
      to: LOCAL_CHECKOUT_ROUTE,
    });
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

  const handleInstallCliLauncher = useCallback(async () => {
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
  }, []);

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
      addLocalCheckout: () => void localCheckoutWorkflow.addCheckout(),
      finishSessionNavigation,
      installCliLauncher: handleInstallCliLauncher,
      isDark,
      isLeftSidebarOpen,
      isRightSidebarOpen,
      sessionNavigation,
      toggleLeftSidebar: () => setIsLeftSidebarOpen((open) => !open),
      toggleRightSidebar: () => setIsRightSidebarOpen((open) => !open),
      toggleTheme,
    }),
    [
      finishSessionNavigation,
      handleInstallCliLauncher,
      isDark,
      isLeftSidebarOpen,
      isRightSidebarOpen,
      localCheckoutWorkflow.addCheckout,
      sessionNavigation,
      toggleTheme,
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
    (pathname === "/" || pathname === "/pulls")
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
        <div className="min-h-0 min-w-0 flex-1">
          <Outlet />
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
          onAddLocalCheckout={() => void localCheckoutWorkflow.addCheckout()}
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
