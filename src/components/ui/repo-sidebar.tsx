import {
  MoonIcon,
  PlusIcon,
  SunIcon,
  CommandLineIcon,
} from "@heroicons/react/20/solid";
import { AppUpdater } from "./app-updater";
import type { ReactNode } from "react";

type RepoSidebarProps = {
  isDark: boolean;
  onInstallCliLauncher: () => void;
  onToggleTheme: () => void;
  onAddRepo: () => void;
  children: ReactNode;
};

function RepoSidebar({
  isDark,
  onInstallCliLauncher,
  onToggleTheme,
  onAddRepo,
  children,
}: RepoSidebarProps) {
  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-ink-300 bg-canvas md:border-b-0">
      <div
        aria-hidden="true"
        className="h-8 shrink-0 bg-canvas"
        data-tauri-drag-region
      />
      <div className="sticky top-0 z-10 flex w-full items-center gap-2.5 bg-canvas px-3 py-2.5 text-sm font-medium">
        Repositories
        <div className="ml-auto flex items-center gap-1.5">
          <AppUpdater
            buttonClassName="rounded-md border-0 bg-transparent px-2 py-1 text-xs font-medium hover:bg-canvasDark dark:bg-transparent dark:hover:bg-canvasDark"
            buttonLabel="Update now"
            containerClassName="flex-row items-center gap-0"
            showFeedback={false}
          />
          <button
            aria-label="Reinstall Rudu command-line launcher"
            className="inline-flex items-center justify-center rounded p-1 text-ink-500 transition hover:bg-canvasDark hover:text-ink-700"
            onClick={onInstallCliLauncher}
            type="button"
          >
            <CommandLineIcon className="size-5 shrink-0" />
          </button>
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
          <button
            aria-label="Add GitHub repository"
            className="inline-flex items-center justify-center rounded p-1 text-ink-500 transition hover:bg-canvasDark hover:text-ink-700"
            onClick={onAddRepo}
            type="button"
          >
            <PlusIcon className="size-5 shrink-0" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-hidden">
        {children}
      </div>
    </aside>
  );
}

export { RepoSidebar };
export type { RepoSidebarProps };
