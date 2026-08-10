import { createContext, useContext } from "react";
import type { RefreshTrackedPullRequests } from "../../hooks/useSelectedPullRequestWorkspace";
import type { SessionNavigation } from "../../queries/local-checkouts-native";

type AppShellContextValue = {
  isDark: boolean;
  isLeftSidebarOpen: boolean;
  sessionNavigation: SessionNavigation | null;
  finishSessionNavigation: (request: SessionNavigation) => void;
  refreshTrackedPullRequests: RefreshTrackedPullRequests;
  toggleLeftSidebar: () => void;
};

const AppShellContext = createContext<AppShellContextValue | null>(null);

function useAppShellContext() {
  const context = useContext(AppShellContext);
  if (!context) {
    throw new Error("useAppShellContext must be used inside AppShellContext");
  }

  return context;
}

export { AppShellContext, useAppShellContext };
export type { AppShellContextValue };
