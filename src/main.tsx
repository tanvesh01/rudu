import React from "react";
import ReactDOM from "react-dom/client";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/geist-mono/700.css";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

const poolSize = Math.max(2, Math.min(4, Math.floor(navigator.hardwareConcurrency / 2) || 2));
const initialDiffTheme = document.documentElement.classList.contains("dark")
  ? "pierre-dark"
  : "pierre-light";

function createPierreDiffsWorker() {
  return new Worker(new URL("./pierre-diffs-worker.ts", import.meta.url), {
    type: "module",
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <WorkerPoolContextProvider
        highlighterOptions={{
          lineDiffType: "word",
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
