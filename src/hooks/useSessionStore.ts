import { useState, useEffect, useCallback, useRef } from "react";
import type {
  SessionManager,
  SessionSnapshot,
  SessionLogLine,
} from "../services/SessionManager.js";
import type { TranscriptMessage } from "../domain/transcript.js";

export interface SessionStore {
  sessions: SessionSnapshot[];
  selectedSessionId: string | null;
  logs: Map<string, SessionLogLine[]>;
  transcripts: Map<string, TranscriptMessage[]>;
}

export function useSessionStore(sessionManager: SessionManager) {
  const [store, setStore] = useState<SessionStore>({
    sessions: [],
    selectedSessionId: null,
    logs: new Map(),
    transcripts: new Map(),
  });

  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    // Initial load
    setStore((prev) => ({
      ...prev,
      sessions: sessionManager.listSessions(),
    }));

    // Subscribe to events
    const unsubscribers: (() => void)[] = [];

    unsubscribers.push(
      sessionManager.on("sessionQueued", ({ session }) => {
        setStore((prev) => ({
          ...prev,
          sessions: [...prev.sessions, session],
        }));
      })
    );

    unsubscribers.push(
      sessionManager.on("sessionStarting", ({ session }) => {
        setStore((prev) => ({
          ...prev,
          sessions: prev.sessions.map((s) =>
            s.id === session.id ? session : s
          ),
        }));
      })
    );

    unsubscribers.push(
      sessionManager.on("sessionStarted", ({ session }) => {
        setStore((prev) => ({
          ...prev,
          sessions: prev.sessions.map((s) =>
            s.id === session.id ? session : s
          ),
        }));
      })
    );

    unsubscribers.push(
      sessionManager.on("sessionLogBatch", ({ sessionId, lines, session }) => {
        setStore((prev) => {
          const newLogs = new Map(prev.logs);
          const existing = newLogs.get(sessionId) || [];
          newLogs.set(sessionId, [...existing, ...lines]);

          // Also update session snapshot
          return {
            ...prev,
            sessions: prev.sessions.map((s) =>
              s.id === session.id ? session : s
            ),
            logs: newLogs,
          };
        });
      })
    );

    unsubscribers.push(
      sessionManager.on("sessionCancelled", ({ session }) => {
        setStore((prev) => ({
          ...prev,
          sessions: prev.sessions.map((s) =>
            s.id === session.id ? session : s
          ),
        }));
      })
    );

    unsubscribers.push(
      sessionManager.on("sessionSucceeded", ({ session }) => {
        setStore((prev) => ({
          ...prev,
          sessions: prev.sessions.map((s) =>
            s.id === session.id ? session : s
          ),
        }));
      })
    );

    unsubscribers.push(
      sessionManager.on("sessionFailed", ({ session }) => {
        setStore((prev) => ({
          ...prev,
          sessions: prev.sessions.map((s) =>
            s.id === session.id ? session : s
          ),
        }));
      })
    );

    unsubscribers.push(
      sessionManager.on("sessionTranscriptUpdate", ({ sessionId, session, message }) => {
        setStore((prev) => {
          const newTranscripts = new Map(prev.transcripts);
          const existing = newTranscripts.get(sessionId) || [];
          // Check if message already exists (update) or is new (append)
          const existingIndex = existing.findIndex((m) => m.id === message.id);
          let newMessages;
          if (existingIndex >= 0) {
            // Update existing message
            newMessages = [...existing];
            newMessages[existingIndex] = message;
          } else {
            // Append new message
            newMessages = [...existing, message];
          }
          newTranscripts.set(sessionId, newMessages);

          // Also update session snapshot
          return {
            ...prev,
            sessions: prev.sessions.map((s) =>
              s.id === session.id ? session : s
            ),
            transcripts: newTranscripts,
          };
        });
      })
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
    [sessionManager]
  );

  const sendSessionMessage = useCallback(
    async (id: string, text: string): Promise<void> => {
      await sessionManager.sendFollowUp(id, text);
    },
    [sessionManager]
  );

  const getSessionLogs = useCallback(
    (id: string): SessionLogLine[] => {
      return storeRef.current.logs.get(id) || [];
    },
    []
  );

  const getSessionTranscripts = useCallback(
    (id: string): TranscriptMessage[] => {
      return storeRef.current.transcripts.get(id) || [];
    },
    []
  );

  return {
    ...store,
    selectSession,
    cancelSession,
    sendSessionMessage,
    getSessionLogs,
    getSessionTranscripts,
  };
}
