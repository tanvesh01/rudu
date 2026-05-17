import { createContext, useContext } from "react";
import type { RefreshTrackedPullRequests } from "../../hooks/useSelectedPullRequestWorkspace";

type AppShellContextValue = {
  isDark: boolean;
  refreshTrackedPullRequests: RefreshTrackedPullRequests;
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
