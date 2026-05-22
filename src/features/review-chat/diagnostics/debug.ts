import { useEffect, useRef } from "react";

declare global {
  interface Window {
    __RUDU_REVIEW_CHAT_DEBUG?: boolean;
  }
}

const DEBUG_STORAGE_KEY = "rudu:review-chat-debug";
const DEBUG_LOG_PREFIX = "[review-chat-debug]";

type DebugSnapshot = Record<string, unknown>;

function isReviewChatDebugEnabled() {
  if (typeof window === "undefined") return false;
  if (window.__RUDU_REVIEW_CHAT_DEBUG === true) return true;

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const urlValue = searchParams.get("reviewChatDebug");
    if (urlValue === "1" || urlValue === "true") return true;
    if (urlValue === "0" || urlValue === "false") return false;

    return window.localStorage.getItem(DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function debugLog(
  level: "debug" | "info" | "warn",
  scope: string,
  payload: DebugSnapshot,
) {
  if (!isReviewChatDebugEnabled()) return;
  console[level](`${DEBUG_LOG_PREFIX} ${scope}`, payload);
}

function getSnapshotChanges(
  previous: DebugSnapshot | null,
  next: DebugSnapshot,
) {
  if (!previous) return Object.keys(next);

  const changed = new Set<string>();
  for (const key of Object.keys(previous)) {
    if (!Object.is(previous[key], next[key])) {
      changed.add(key);
    }
  }
  for (const key of Object.keys(next)) {
    if (!Object.is(previous[key], next[key])) {
      changed.add(key);
    }
  }

  return [...changed];
}

function useReviewChatRenderDebug(
  component: string,
  getSnapshot: () => DebugSnapshot,
) {
  const snapshot = getSnapshot();
  const previousSnapshotRef = useRef<DebugSnapshot | null>(null);
  const rendersInWindowRef = useRef(0);
  const totalRendersRef = useRef(0);
  const windowStartedAtRef = useRef(0);

  useEffect(() => {
    if (!isReviewChatDebugEnabled()) {
      previousSnapshotRef.current = snapshot;
      return;
    }

    const now = performance.now();
    if (windowStartedAtRef.current === 0) {
      windowStartedAtRef.current = now;
    }

    rendersInWindowRef.current += 1;
    totalRendersRef.current += 1;

    const elapsed = now - windowStartedAtRef.current;
    if (elapsed >= 1000 || rendersInWindowRef.current === 1) {
      const previousSnapshot = previousSnapshotRef.current;
      const changed = getSnapshotChanges(previousSnapshot, snapshot);
      debugLog("debug", `render:${component}`, {
        changed,
        elapsedMs: Math.round(elapsed),
        rendersInWindow: rendersInWindowRef.current,
        snapshot,
        totalRenders: totalRendersRef.current,
      });
      rendersInWindowRef.current = 0;
      windowStartedAtRef.current = now;
    }

    previousSnapshotRef.current = snapshot;
  });
}

function useReviewChatMainThreadStallDebug(active: boolean, scope: string) {
  useEffect(() => {
    if (!active || !isReviewChatDebugEnabled()) return;

    const intervalMs = 250;
    const warnAfterMs = 150;
    let expectedAt = performance.now() + intervalMs;

    const intervalId = window.setInterval(() => {
      const now = performance.now();
      const drift = now - expectedAt;
      if (drift > warnAfterMs) {
        debugLog("warn", `main-thread-stall:${scope}`, {
          driftMs: Math.round(drift),
          expectedIntervalMs: intervalMs,
        });
      }
      expectedAt = now + intervalMs;
    }, intervalMs);

    return () => window.clearInterval(intervalId);
  }, [active, scope]);
}

function summarizeCounts(counts: Map<string, number>) {
  return Object.fromEntries(
    [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
}

function createReviewChatStreamDebug(turnId: string) {
  if (!isReviewChatDebugEnabled()) {
    return {
      event: (_kind: string, _chunks: { type: string }[]) => {},
      flush: (_rawChunkCount: number, _compactedChunkCount: number) => {},
      settle: (_reason: string) => {},
      start: () => {},
      step: (_name: string) => {},
    };
  }

  const startedAt = performance.now();
  const eventCounts = new Map<string, number>();
  const chunkCounts = new Map<string, number>();
  let mappedChunkCount = 0;
  let flushedChunkCount = 0;
  let lastSummaryAt = startedAt;

  function summary(reason: string) {
    const now = performance.now();
    debugLog("info", `stream:${reason}`, {
      chunksByType: summarizeCounts(chunkCounts),
      elapsedMs: Math.round(now - startedAt),
      eventsByKind: summarizeCounts(eventCounts),
      flushedChunkCount,
      mappedChunkCount,
      turnId,
    });
    lastSummaryAt = now;
  }

  return {
    event(kind: string, chunks: { type: string }[]) {
      eventCounts.set(kind, (eventCounts.get(kind) ?? 0) + 1);
      mappedChunkCount += chunks.length;
      for (const chunk of chunks) {
        chunkCounts.set(chunk.type, (chunkCounts.get(chunk.type) ?? 0) + 1);
      }

      const now = performance.now();
      if (now - lastSummaryAt >= 1000) {
        summary("summary");
      }
    },
    flush(rawChunkCount: number, compactedChunkCount: number) {
      flushedChunkCount += compactedChunkCount;
      debugLog("debug", "stream:flush", {
        compactedChunkCount,
        rawChunkCount,
        turnId,
      });
    },
    settle(reason: string) {
      summary(reason);
    },
    start() {
      debugLog("info", "stream:start", { turnId });
    },
    step(name: string) {
      debugLog("debug", "stream:step", {
        elapsedMs: Math.round(performance.now() - startedAt),
        name,
        turnId,
      });
    },
  };
}

export {
  DEBUG_STORAGE_KEY,
  createReviewChatStreamDebug,
  debugLog,
  isReviewChatDebugEnabled,
  useReviewChatMainThreadStallDebug,
  useReviewChatRenderDebug,
};
