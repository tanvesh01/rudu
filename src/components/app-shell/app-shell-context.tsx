import { createContext, useContext } from "react";
import type { SessionNavigation } from "../../queries/local-checkouts-native";

type AppShellContextValue = {
  addLocalCheckout: () => void;
  finishSessionNavigation: (request: SessionNavigation) => void;
  installCliLauncher: () => void;
  isDark: boolean;
  isLeftSidebarOpen: boolean;
  isRightSidebarOpen: boolean;
  sessionNavigation: SessionNavigation | null;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  toggleTheme: () => void;
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
