import { MoonIcon, PlusIcon, SunIcon } from "@heroicons/react/20/solid";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Accordion } from "./accordion";
import { AppUpdater } from "./app-updater";
import { RepoSidebarItem, type PullRequestSummary } from "./repo-sidebar-item";
import type { RepoSummary } from "../../types/github";

type RepoSidebarProps = {
  repos: RepoSummary[];
  prsByRepo: Record<string, PullRequestSummary[]>;
  repoErrors: Record<string, string>;
  openValues: string[];
  selectedPrKey: string | null;
  isDark: boolean;
  onAddRepo: () => void;
  onAddPr: (repo: string) => void;
  onToggleTheme: () => void;
  onSelectPr: (repo: string, pullRequest: PullRequestSummary) => void;
  onRemovePr: (repo: string, pullRequest: PullRequestSummary) => void;
  onRepoOpenChange: (repo: string, open: boolean) => void;
};

function RepoSidebar({
  repos,
  prsByRepo,
  repoErrors,
  openValues,
  selectedPrKey,
  isDark,
  onAddRepo,
  onAddPr,
  onToggleTheme,
  onSelectPr,
  onRemovePr,
  onRepoOpenChange,
}: RepoSidebarProps) {
  const appWindow = getCurrentWindow();

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-ink-300 bg-canvas md:border-b-0">
      <div
        aria-hidden="true"
        className="h-8 shrink-0 cursor-grab bg-canvas active:cursor-grabbing"
        data-tauri-drag-region
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          if (event.detail === 2) {
            void appWindow.toggleMaximize();
            return;
          }
          void appWindow.startDragging();
        }}
      />
      <div className="sticky top-0 z-10 flex w-full items-center gap-2.5 border-b border-neutral-300 dark:border-neutral-700 bg-canvas px-3 py-2.5 text-sm font-medium">
        Repositories
        <div className="ml-auto flex items-center gap-1.5">
          <AppUpdater
            buttonClassName="rounded-md border-0 bg-transparent px-2 py-1 text-xs font-medium hover:bg-canvasDark dark:bg-transparent dark:hover:bg-canvasDark"
            buttonLabel="Update now"
            containerClassName="flex-row items-center gap-0"
            showFeedback={false}
          />
          <button
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className="inline-flex items-center justify-center rounded p-1 text-ink-500 transition hover:bg-canvasDark hover:text-ink-700"
            onClick={onToggleTheme}
            type="button"
          >
            {isDark ? (
              <SunIcon className="size-5 shrink-0" />
            ) : (
              <MoonIcon className="size-5 shrink-0" />
            )}
          </button>
        </div>
        <button
          aria-label="Add repo"
          className="inline-flex items-center justify-center rounded p-1 text-ink-500 transition hover:bg-canvasDark hover:text-ink-700"
          onClick={onAddRepo}
          type="button"
        >
          <PlusIcon className="size-5 shrink-0" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hidden">
        <Accordion multiple value={openValues}>
          {repos.map((repo) => (
            <RepoSidebarItem
              key={repo.nameWithOwner}
              value={repo.nameWithOwner}
              nameWithOwner={repo.nameWithOwner}
              pullRequests={prsByRepo[repo.nameWithOwner]}
              error={repoErrors[repo.nameWithOwner]}
              selectedPrKey={selectedPrKey}
              onSelectPr={(name, pr) => onSelectPr(name, pr)}
              onAddPr={(name) => onAddPr(name)}
              onRemovePr={(name, pr) => onRemovePr(name, pr)}
              onOpenChange={(open) =>
                onRepoOpenChange(repo.nameWithOwner, open)
              }
            />
          ))}
        </Accordion>
      </div>
    </aside>
  );
}

export { RepoSidebar };
export type { RepoSidebarProps, RepoSummary };
