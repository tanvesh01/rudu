import { create } from "zustand";

type RevisionRefreshGateMode =
  | "up_to_date"
  | "update_available"
  | "refreshing"
  | "refresh_failed";

type RevisionRefreshGateRevision = {
  activeHeadSha: string;
  latestHeadSha: string;
  sessionId: string;
};

type RevisionCheckpoint = {
  id: string;
  headSha: string;
  messageCount: number;
  previousHeadSha: string;
  sessionId: string;
};

type RevisionRefreshGateState = {
  checkpoints: RevisionCheckpoint[];
  mode: RevisionRefreshGateMode;
  revision: RevisionRefreshGateRevision | null;
  error: string | null;
  observeRevision(input: {
    activeHeadSha: string | null;
    latestHeadSha: string | null;
    sessionId: string | null;
  }): void;
  startRefresh(): boolean;
  finishRefresh(input: {
    activeHeadSha: string;
    messageCount: number;
    sessionId: string;
  }): void;
  failRefresh(error: string): void;
  reset(): void;
};

const REVISION_REFRESH_GATE_INITIAL_STATE = {
  checkpoints: [],
  mode: "up_to_date",
  revision: null,
  error: null,
} satisfies Pick<
  RevisionRefreshGateState,
  "checkpoints" | "mode" | "revision" | "error"
>;

function normalizeRevision(input: {
  activeHeadSha: string | null;
  latestHeadSha: string | null;
  sessionId: string | null;
}): RevisionRefreshGateRevision | null {
  if (!input.activeHeadSha || !input.latestHeadSha || !input.sessionId) {
    return null;
  }

  return {
    activeHeadSha: input.activeHeadSha,
    latestHeadSha: input.latestHeadSha,
    sessionId: input.sessionId,
  };
}

function isSameRevision(
  left: RevisionRefreshGateRevision | null,
  right: RevisionRefreshGateRevision | null,
) {
  return (
    left?.activeHeadSha === right?.activeHeadSha &&
    left?.latestHeadSha === right?.latestHeadSha &&
    left?.sessionId === right?.sessionId
  );
}

function createRevisionRefreshGateState() {
  return {
    ...REVISION_REFRESH_GATE_INITIAL_STATE,
    observeRevision: () => undefined,
    startRefresh: () => false,
    finishRefresh: () => undefined,
    failRefresh: () => undefined,
    reset: () => undefined,
  } satisfies RevisionRefreshGateState;
}

function createRevisionRefreshGateStore() {
  return create<RevisionRefreshGateState>()((set, get) => ({
    ...REVISION_REFRESH_GATE_INITIAL_STATE,
    observeRevision: (input) => {
      const revision = normalizeRevision(input);

      if (!revision) {
        set(REVISION_REFRESH_GATE_INITIAL_STATE);
        return;
      }

      if (revision.activeHeadSha === revision.latestHeadSha) {
        set({
          mode: "up_to_date",
          revision,
          error: null,
        });
        return;
      }

      const current = get();
      if (
        (current.mode === "refreshing" || current.mode === "refresh_failed") &&
        isSameRevision(current.revision, revision)
      ) {
        return;
      }

      set({
        mode: "update_available",
        revision,
        error: null,
      });
    },
    startRefresh: () => {
      const current = get();
      if (
        current.mode !== "update_available" &&
        current.mode !== "refresh_failed"
      ) {
        return false;
      }

      set({
        mode: "refreshing",
        error: null,
      });
      return true;
    },
    finishRefresh: ({ activeHeadSha, messageCount, sessionId }) => {
      const current = get();
      const previousHeadSha = current.revision?.activeHeadSha ?? activeHeadSha;
      const checkpoints =
        previousHeadSha === activeHeadSha
          ? current.checkpoints
          : [
              ...current.checkpoints,
              {
                id: `${sessionId}:${activeHeadSha}:${Date.now()}`,
                headSha: activeHeadSha,
                messageCount,
                previousHeadSha,
                sessionId,
              },
            ];

      set({
        checkpoints,
        mode: "up_to_date",
        revision: {
          activeHeadSha,
          latestHeadSha: activeHeadSha,
          sessionId,
        },
        error: null,
      });
    },
    failRefresh: (error) => {
      const current = get();
      if (!current.revision) {
        set({
          mode: "refresh_failed",
          revision: null,
          error,
        });
        return;
      }

      set({
        mode: "refresh_failed",
        revision: current.revision,
        error,
      });
    },
    reset: () => set(REVISION_REFRESH_GATE_INITIAL_STATE),
  }));
}

function isRevisionRefreshBlockingPrompt(mode: RevisionRefreshGateMode) {
  return (
    mode === "update_available" ||
    mode === "refreshing" ||
    mode === "refresh_failed"
  );
}

const useRevisionRefreshGateStore = createRevisionRefreshGateStore();

export {
  createRevisionRefreshGateState,
  createRevisionRefreshGateStore,
  isRevisionRefreshBlockingPrompt,
  REVISION_REFRESH_GATE_INITIAL_STATE,
  useRevisionRefreshGateStore,
};
export type {
  RevisionCheckpoint,
  RevisionRefreshGateMode,
  RevisionRefreshGateRevision,
  RevisionRefreshGateState,
};
