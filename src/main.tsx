import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/geist-mono/700.css";
import App from "./App";
import "./index.css";
import PierreDiffsWorker from "@pierre/diffs/worker/worker-portable.js?worker";
import { githubKeys } from "./queries/github";
import type { PullRequestSummary, RepoSummary } from "./types/github";

type InitialCachePayload = {
  repos: RepoSummary[];
  trackedPrsByRepo: Record<string, PullRequestSummary[]>;
};

const poolSize = Math.max(
  2,
  Math.min(4, Math.floor(navigator.hardwareConcurrency / 2) || 2),
);
const initialDiffTheme = document.documentElement.classList.contains("dark")
  ? "pierre-dark"
  : "pierre-light";

function createPierreDiffsWorker() {
  return new PierreDiffsWorker();
}

async function bootstrap() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        networkMode: "always",
        refetchOnWindowFocus: false,
      },
    },
  });

  // Prime the TanStack Query cache from the local Rust SQLite cache
  // so the sidebar renders with data on the very first frame
  try {
    const initialData = await invoke<InitialCachePayload>("get_initial_cache");
    const { repos, trackedPrsByRepo } = initialData;

    if (repos.length > 0) {
      queryClient.setQueryData(githubKeys.savedRepos(), repos);
    }

    for (const [repo, prs] of Object.entries(trackedPrsByRepo)) {
      queryClient.setQueryData(
        githubKeys.trackedPullRequestList(repo),
        prs,
      );
    }
  } catch {
    // First run — no cache yet. The app renders normally with empty data.
  }

  focusManager.setEventListener((setFocused) => {
    const handleVisibilityChange = () => setFocused();
    let unlistenFocus: UnlistenFn | null = null;
    let didCleanup = false;

    window.addEventListener("visibilitychange", handleVisibilityChange, false);

    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        setFocused(focused);
      })
      .then((unlisten) => {
        if (didCleanup) {
          unlisten();
          return;
        }

        unlistenFocus = unlisten;
      })
      .catch(() => {
        // Browser visibility events still cover non-Tauri environments.
      });

    return () => {
      didCleanup = true;
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      unlistenFocus?.();
    };
  });

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <WorkerPoolContextProvider
          highlighterOptions={{
            lineDiffType: "word",
            preferredHighlighter: "shiki-js",
            theme: initialDiffTheme,
          }}
          poolOptions={{
            poolSize,
            workerFactory: createPierreDiffsWorker,
          }}
        >
          <App queryClient={queryClient} />
        </WorkerPoolContextProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

bootstrap();
