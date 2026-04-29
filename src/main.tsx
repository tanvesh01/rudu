import React from "react";
import ReactDOM from "react-dom/client";
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

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

const poolSize = Math.max(2, Math.min(4, Math.floor(navigator.hardwareConcurrency / 2) || 2));
const initialDiffTheme = document.documentElement.classList.contains("dark")
  ? "pierre-dark"
  : "pierre-light";

function createPierreDiffsWorker() {
  return new PierreDiffsWorker();
}

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
        <App />
      </WorkerPoolContextProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
