import { useRouterState } from "@tanstack/react-router";
import { useLocalCheckoutWorkflow } from "../../hooks/useLocalCheckoutWorkflow";
import { AppResizablePanes } from "../ui/app-resizable-panes";
import { LocalCheckoutList } from "../ui/repo-sidebar-lists";
import { RepoSidebar } from "../ui/repo-sidebar";
import { AppSectionNavigation } from "./app-section-navigation";
import { useAppShellContext } from "./app-shell-context";

function LocalCheckoutListScreen() {
  const { isLeftSidebarOpen } = useAppShellContext();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const workflow = useLocalCheckoutWorkflow({ pathname });

  return (
    <main className="h-full min-h-0 min-w-0 bg-surface">
      <AppResizablePanes
        center={
          <RepoSidebar>
            <LocalCheckoutList
              checkouts={workflow.checkouts}
              onSelectCheckout={workflow.selectCheckout}
            />
          </RepoSidebar>
        }
        left={<AppSectionNavigation />}
        leftOpen={isLeftSidebarOpen}
      />
    </main>
  );
}

export { LocalCheckoutListScreen };
