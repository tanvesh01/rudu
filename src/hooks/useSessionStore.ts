import { useState, useEffect, useCallback, useRef } from "react";
import type {
  SessionManager,
  SessionLogLine,
} from "../services/SessionManager.js";
import type { TranscriptMessage } from "../domain/transcript.js";
import {
  appendSessionLogs,
  createInitialSessionStore,
  replaceSessionSnapshot,
  type SessionStoreState,
  upsertTranscriptMessage,
} from "./session-store-helpers.js";

/**
 * Flat worktree selection state for single-session mode.
 *
 * In this simplified model:
 * - We track only the selected worktree ID
 * - The associated session is implicitly derived from the worktree
 * - No tree node types or complex hierarchy
 */
export interface FlatSessionStore extends SessionStoreState {
  selectedWorktreeId: string | null;
}

export function useSessionStore(sessionManager: SessionManager) {
  const [store, setStore] = useState<FlatSessionStore>(() => {
    const initialStore = createInitialSessionStore(sessionManager);
    // In flat mode, initialize with the worktree of the first session (if any)
    const firstSession = initialStore.sessions[0];
    return {
      ...initialStore,
      selectedWorktreeId: firstSession?.worktreeId ?? null,
    };
  });

  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    setStore(createInitialSessionStore(sessionManager));

    const unsubscribers: (() => void)[] = [];
    const updateSession = (
      session: Parameters<typeof replaceSessionSnapshot>[1],
    ) =>
      setStore((prev) => ({
        ...prev,
        sessions: replaceSessionSnapshot(prev.sessions, session),
      }));

    unsubscribers.push(
      sessionManager.on("sessionQueued", ({ session }) => {
        updateSession(session);
        // Auto-select the worktree of the new session if none selected
        setStore((prev) => {
          if (prev.selectedWorktreeId === null && session?.worktreeId) {
            return {
              ...prev,
              selectedWorktreeId: session.worktreeId,
            };
          }
          return prev;
        });
      }),
    );

    unsubscribers.push(
      sessionManager.on("sessionStarting", ({ session }) => {
        updateSession(session);
      }),
    );

    unsubscribers.push(
      sessionManager.on("sessionStarted", ({ session }) => {
        updateSession(session);
      }),
    );

    unsubscribers.push(
      sessionManager.on("sessionLogBatch", ({ sessionId, lines, session }) => {
        setStore((prev) => {
          return {
            ...prev,
            sessions: replaceSessionSnapshot(prev.sessions, session),
            logs: appendSessionLogs(prev.logs, sessionId, lines),
          };
        });
      }),
    );

    unsubscribers.push(
      sessionManager.on("sessionCancelled", ({ session }) => {
        updateSession(session);
      }),
    );

    unsubscribers.push(
      sessionManager.on("sessionSucceeded", ({ session }) => {
        updateSession(session);
      }),
    );

    unsubscribers.push(
      sessionManager.on("sessionFailed", ({ session }) => {
        updateSession(session);
      }),
    );

    unsubscribers.push(
      sessionManager.on(
        "sessionTranscriptUpdate",
        ({ sessionId, session, message }) => {
          setStore((prev) => {
            return {
              ...prev,
              sessions: replaceSessionSnapshot(prev.sessions, session),
              transcripts: upsertTranscriptMessage(
                prev.transcripts,
                sessionId,
                message,
              ),
            };
          });
        },
      ),
    );

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [sessionManager]);

  /**
   * Select a worktree by ID (flat mode).
   * In single-session mode, selecting a worktree implicitly targets its session.
   */
  const selectWorktree = useCallback((worktreeId: string | null) => {
    setStore((prev) => ({
      ...prev,
      selectedWorktreeId: worktreeId,
    }));
  }, []);

  const cancelSession = useCallback(
    (id: string) => {
      sessionManager.cancelSession(id, "user");
    },
    [sessionManager],
  );

  const sendSessionMessage = useCallback(
    async (id: string, text: string): Promise<void> => {
      await sessionManager.sendFollowUp(id, text);
    },
    [sessionManager],
  );

  const hydrateSessionHistory = useCallback(
    async (id: string): Promise<void> => {
      await sessionManager.hydrateSessionHistory(id);
    },
    [sessionManager],
  );

  const getSessionLogs = useCallback((id: string): SessionLogLine[] => {
    return storeRef.current.logs.get(id) || [];
  }, []);

  const getSessionTranscripts = useCallback(
    (id: string): TranscriptMessage[] => {
      return storeRef.current.transcripts.get(id) || [];
    },
    [],
  );

  return {
    ...store,
    selectWorktree,
    cancelSession,
    sendSessionMessage,
    hydrateSessionHistory,
    getSessionLogs,
    getSessionTranscripts,
  };
}
