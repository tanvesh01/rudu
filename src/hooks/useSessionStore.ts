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

export interface SessionStore extends SessionStoreState {}

export function useSessionStore(sessionManager: SessionManager) {
  const [store, setStore] = useState<SessionStore>(() => {
    const initialStore = createInitialSessionStore(sessionManager);
    // Auto-select first session if none is selected
    const firstSession = initialStore.sessions[0];
    if (firstSession && initialStore.selectedSessionId === null) {
      initialStore.selectedSessionId = firstSession.id;
    }
    return initialStore;
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
        // Auto-select first session if none selected
        setStore((prev) => {
          if (prev.selectedSessionId === null && session) {
            return { ...prev, selectedSessionId: session.id };
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

  const selectSession = useCallback((id: string | null) => {
    setStore((prev) => ({ ...prev, selectedSessionId: id }));
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
    selectSession,
    cancelSession,
    sendSessionMessage,
    hydrateSessionHistory,
    getSessionLogs,
    getSessionTranscripts,
  };
}
