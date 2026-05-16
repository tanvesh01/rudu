import { Toast } from "@base-ui/react/toast";
import { createRootRouteWithContext } from "@tanstack/react-router";
import { AppShell } from "../components/app-shell/app-shell";
import { AppToastViewport } from "../components/ui/app-toast-viewport";
import { useGhCliStatusToasts } from "../hooks/useGhCliStatusToasts";
import { appToastManager } from "../lib/toasts";
import type { AppRouterContext } from "../router-context";

export const Route = createRootRouteWithContext<AppRouterContext>()({
  component: RootRoute,
});

function RootRoute() {
  useGhCliStatusToasts();

  return (
    <Toast.Provider toastManager={appToastManager}>
      <AppShell />
      <AppToastViewport />
    </Toast.Provider>
  );
}
