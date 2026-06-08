import { useSyncExternalStore } from "react";

const DEFAULT_WALKTHROUGH_PROGRESS_MESSAGE = "Generating walkthrough";

type ReviewWalkthroughCommandState = {
  isGenerating: true;
  progressMessage: string;
};

const walkthroughCommandStates = new Map<string, ReviewWalkthroughCommandState>();
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribeToWalkthroughCommandState(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getWalkthroughCommandState(sessionId: string | null) {
  if (!sessionId) return null;
  return walkthroughCommandStates.get(sessionId) ?? null;
}

function setWalkthroughCommandState(
  sessionId: string,
  progressMessage: string,
) {
  walkthroughCommandStates.set(sessionId, {
    isGenerating: true,
    progressMessage,
  });
  emitChange();
}

function clearWalkthroughCommandState(sessionId: string) {
  if (!walkthroughCommandStates.delete(sessionId)) {
    return;
  }
  emitChange();
}

function useWalkthroughCommandState(sessionId: string | null) {
  return useSyncExternalStore(
    subscribeToWalkthroughCommandState,
    () => getWalkthroughCommandState(sessionId),
    () => getWalkthroughCommandState(sessionId),
  );
}

export {
  clearWalkthroughCommandState,
  DEFAULT_WALKTHROUGH_PROGRESS_MESSAGE,
  setWalkthroughCommandState,
  useWalkthroughCommandState,
};
export type { ReviewWalkthroughCommandState };
