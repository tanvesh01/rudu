import type { TranscriptMessage } from "../domain/transcript.js";
import type {
  SessionLogLine,
  SessionSnapshot,
  SessionManager,
} from "../services/SessionManager.js";

export interface SessionStoreState {
  sessions: SessionSnapshot[];
  selectedSessionId: string | null;
  logs: Map<string, SessionLogLine[]>;
  transcripts: Map<string, TranscriptMessage[]>;
}

export function replaceSessionSnapshot(
  sessions: SessionSnapshot[],
  session: SessionSnapshot,
): SessionSnapshot[] {
  const index = sessions.findIndex((existing) => existing.id === session.id);
  if (index === -1) return [...sessions, session];

  const next = [...sessions];
  next[index] = session;
  return next;
}

export function appendSessionLogs(
  logs: Map<string, SessionLogLine[]>,
  sessionId: string,
  lines: readonly SessionLogLine[],
): Map<string, SessionLogLine[]> {
  const next = new Map(logs);
  const existing = next.get(sessionId) ?? [];
  next.set(sessionId, [...existing, ...lines]);
  return next;
}

export function upsertTranscriptMessage(
  transcripts: Map<string, TranscriptMessage[]>,
  sessionId: string,
  message: TranscriptMessage,
): Map<string, TranscriptMessage[]> {
  const next = new Map(transcripts);
  const existing = next.get(sessionId) ?? [];
  const index = existing.findIndex((entry) => entry.id === message.id);

  if (index === -1) {
    next.set(sessionId, [...existing, message]);
    return next;
  }

  const updated = [...existing];
  updated[index] = message;
  next.set(sessionId, updated);
  return next;
}

export function createInitialSessionStore(
  sessionManager: SessionManager,
): SessionStoreState {
  const sessions = sessionManager.listSessions();
  const logs = new Map<string, SessionLogLine[]>();
  const transcripts = new Map<string, TranscriptMessage[]>();

  for (const session of sessions) {
    logs.set(session.id, [...sessionManager.getSessionLogs(session.id)]);
    transcripts.set(session.id, [
      ...sessionManager.getSessionTranscripts(session.id),
    ]);
  }

  return {
    sessions,
    selectedSessionId: sessions[0]?.id ?? null,
    logs,
    transcripts,
  };
}
