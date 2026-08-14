import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { PlusIcon } from "@heroicons/react/20/solid";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useDiffStyle } from "../../hooks/use-diff-style";
import { validatePullRequestListRouteSearch } from "../../lib/pull-request-list-route";
import { pullRequestInboxQueryOptions } from "../../queries/github";
import { usePickerWorkflowStore } from "../../stores";
import {
  DiffStyleToggle,
  LeftSidebarToggle,
  RightSidebarToggle,
} from "../ui/diff-style-toggle";
import {
  ALL_REPOSITORIES,
  RepositoryCombobox,
} from "../ui/repository-combobox";
import { useAppShellContext } from "./app-shell-context";

function AppTopBar() {
  const appWindow = getCurrentWindow();
  const navigate = useNavigate({ from: "/pulls" });
  const { pathname, search } = useRouterState({
    select: (state) => state.location,
  });
  const {
    addLocalCheckout,
    isLeftSidebarOpen,
    isRightSidebarOpen,
    toggleLeftSidebar,
    toggleRightSidebar,
  } = useAppShellContext();
  const [diffStyle, setDiffStyle] = useDiffStyle();
  const openRepoPicker = usePickerWorkflowStore(
    (state) => state.actions.openRepoPicker,
  );
  const isPullRequestList = pathname === "/pulls";
  const isLocalCheckoutList = pathname === "/local" || pathname === "/local/";
  const isDiffDetails =
    pathname.startsWith("/repos/") ||
    (pathname.startsWith("/local/") && !isLocalCheckoutList);
  const inboxQuery = useQuery({
    ...pullRequestInboxQueryOptions(),
    enabled: isPullRequestList,
  });
  const repositories = Array.from(
    new Set(
      (inboxQuery.data?.pullRequests ?? []).map(
        (pullRequest) => pullRequest.repo,
      ),
    ),
  ).sort((a, b) => a.localeCompare(b));
  const pullRequestSearch = validatePullRequestListRouteSearch(
    search as Record<string, unknown>,
  );
  const activeRepo =
    pullRequestSearch.repo && repositories.includes(pullRequestSearch.repo)
      ? pullRequestSearch.repo
      : ALL_REPOSITORIES;
  const scope = pullRequestSearch.scope ?? "inbox";

  function setPullRequestRepo(repo: string) {
    if (repo === ALL_REPOSITORIES) {
      void navigate({ search: {} });
      return;
    }

    void navigate({
      search: { repo, ...(scope === "all" ? { scope } : {}) },
    });
  }

  return (
    <div
      className={`flex h-10 shrink-0 items-center justify-between border-b border-ink-200/60 pr-2 ${isLeftSidebarOpen ? "pl-2" : "pl-20"}`}
      data-tauri-drag-region
      onMouseDown={(event) => {
        if (
          event.button !== 0 ||
          (event.target as Element).closest("button")
        )
          return;
        void appWindow.startDragging();
      }}
    >
      <div className="flex min-w-0 items-center gap-1">
        <LeftSidebarToggle
          open={isLeftSidebarOpen}
          onClick={toggleLeftSidebar}
        />
        {isPullRequestList ? (
          <>
            <RepositoryCombobox
              repositories={repositories}
              value={activeRepo}
              onValueChange={setPullRequestRepo}
            />
            {activeRepo !== ALL_REPOSITORIES ? (
              <ToggleGroup
                aria-label="Pull request scope"
                className="flex h-7 items-center rounded-md bg-canvasDark p-0.5 text-xs"
                onValueChange={(value) => {
                  const nextScope = value[0];
                  if (nextScope !== "all" && nextScope !== "inbox") return;
                  void navigate({
                    search: {
                      repo: activeRepo,
                      ...(nextScope === "all" ? { scope: "all" } : {}),
                    },
                  });
                }}
                value={[scope]}
              >
                <Toggle
                  className="h-6 rounded px-2 text-ink-500 outline-none transition hover:text-ink-700 aria-pressed:bg-surface aria-pressed:text-ink-800 aria-pressed:shadow-sm"
                  value="inbox"
                >
                  Inbox
                </Toggle>
                <Toggle
                  className="h-6 rounded px-2 text-ink-500 outline-none transition hover:text-ink-700 aria-pressed:bg-surface aria-pressed:text-ink-800 aria-pressed:shadow-sm"
                  value="all"
                >
                  All
                </Toggle>
              </ToggleGroup>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {isPullRequestList ? (
          <button
            aria-label="Add GitHub pull request"
            className="inline-flex size-7 items-center justify-center rounded-md text-ink-500 transition hover:bg-canvasDark hover:text-ink-900"
            onClick={openRepoPicker}
            title="Add GitHub pull request"
            type="button"
          >
            <PlusIcon className="size-5" />
          </button>
        ) : null}
        {isLocalCheckoutList ? (
          <button
            aria-label="Add local checkout"
            className="inline-flex size-7 items-center justify-center rounded-md text-ink-500 transition hover:bg-canvasDark hover:text-ink-900"
            onClick={addLocalCheckout}
            title="Add local checkout"
            type="button"
          >
            <PlusIcon className="size-5" />
          </button>
        ) : null}
        {isDiffDetails ? (
          <>
            <DiffStyleToggle onChange={setDiffStyle} value={diffStyle} />
            <RightSidebarToggle
              open={isRightSidebarOpen}
              onClick={toggleRightSidebar}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

export { AppTopBar };
