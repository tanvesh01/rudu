import { useQuery } from "@tanstack/react-query";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CommandLineIcon,
  MoonIcon,
  SunIcon,
} from "@heroicons/react/20/solid";
import { localCheckoutListQueryOptions } from "../../queries/local-checkouts";
import { AppUpdater } from "../ui/app-updater";
import { useAppShellContext } from "./app-shell-context";

const linkClassName =
  "flex h-8 items-center rounded-md px-2 text-sm font-normal whitespace-nowrap text-ink-500 outline-none transition hover:text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600";

function AppSectionNavigation() {
  const { installCliLauncher, isDark, toggleTheme } = useAppShellContext();
  const router = useRouter();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const appWindow = getCurrentWindow();
  const activeSection = pathname.startsWith("/local") ? "local" : "pulls";
  const localCheckoutCount = useQuery(localCheckoutListQueryOptions()).data?.length ?? 0;

  return (
    <nav
      aria-label="App sections"
      className="flex shrink-0 flex-col gap-1 bg-surface px-2 pb-2"
    >
      <div
        className="flex h-10 shrink-0 cursor-grab items-center gap-1 pl-[72px] active:cursor-grabbing"
        data-tauri-drag-region
        onMouseDown={(event) => {
          if (event.button !== 0 || event.target !== event.currentTarget) return;
          if (event.detail === 2) {
            void appWindow.toggleMaximize();
            return;
          }
          void appWindow.startDragging();
        }}
      >
        <AppUpdater
          buttonClassName="rounded-md border-0 bg-transparent px-2 py-1 text-xs font-medium hover:bg-canvasDark dark:bg-transparent dark:hover:bg-canvasDark"
          buttonLabel="Update now"
          containerClassName="flex-row items-center gap-0"
          showFeedback={false}
        />
        <button
          aria-label="Go back"
          className="inline-flex items-center justify-center rounded p-1 text-ink-500 transition hover:bg-canvasDark hover:text-ink-700"
          onClick={() => router.history.back()}
          title="Go back"
          type="button"
        >
          <ArrowLeftIcon className="size-4 shrink-0" />
        </button>
        <button
          aria-label="Go forward"
          className="inline-flex items-center justify-center rounded p-1 text-ink-500 transition hover:bg-canvasDark hover:text-ink-700"
          onClick={() => router.history.forward()}
          title="Go forward"
          type="button"
        >
          <ArrowRightIcon className="size-4 shrink-0" />
        </button>
        <button
          aria-label="Reinstall Rudu command-line launcher"
          className="inline-flex items-center justify-center rounded p-1 text-ink-500 transition hover:bg-canvasDark hover:text-ink-700"
          onClick={installCliLauncher}
          type="button"
        >
          <CommandLineIcon className="size-5 shrink-0" />
        </button>
        <button
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          className="inline-flex items-center justify-center rounded p-1 text-ink-500 transition hover:bg-canvasDark hover:text-ink-700"
          onClick={toggleTheme}
          type="button"
        >
          {isDark ? (
            <SunIcon className="size-5 shrink-0" />
          ) : (
            <MoonIcon className="size-5 shrink-0" />
          )}
        </button>
      </div>
      <Link
        aria-current={activeSection === "local" ? "page" : undefined}
        className={`${linkClassName} ${activeSection === "local" ? "bg-canvasDark text-ink-900" : ""}`}
        to="/local"
      >
        Local checkouts
        <span className="ml-auto tabular-nums">{localCheckoutCount}</span>
      </Link>
      <Link
        aria-current={activeSection === "pulls" ? "page" : undefined}
        className={`${linkClassName} ${activeSection === "pulls" ? "bg-canvasDark text-ink-900" : ""}`}
        to="/pulls"
      >
        Pull requests
      </Link>
    </nav>
  );
}

export { AppSectionNavigation };
