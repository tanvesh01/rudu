import {
  MoonIcon,
  PlusIcon,
  SunIcon,
} from "@heroicons/react/20/solid";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppUpdater } from "./app-updater";
import type { ReactNode } from "react";

type RepoSidebarProps = {
  isDark: boolean;
  onToggleTheme: () => void;
  onAddRepo: () => void;
  children: ReactNode;
};

function RepoSidebar({
  isDark,
  onToggleTheme,
  onAddRepo,
  children,
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

      <div className="min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-hidden">
        {children}
      </div>
    </aside>
  );
}

export { RepoSidebar };
export type { RepoSidebarProps };
