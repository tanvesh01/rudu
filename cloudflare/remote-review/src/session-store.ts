import {
  DIRECTORY_PREFIX,
  FILE_PREFIX,
  SESSION_STORAGE_KEY,
  SESSION_TTL_SECONDS,
  TOKEN_STORAGE_KEY,
} from "./constants";
import { errorResponse } from "./http";
import { sessionIdFor } from "./session-id";
import type {
  RemoteReviewSession,
  ValidatedPrepareSessionInput,
  ValidatedStatusUpdateInput,
} from "./types";

export function nowUnixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function sessionExpiresAt(session: RemoteReviewSession) {
  return session.fileContext?.expiresAt ?? session.createdAt + SESSION_TTL_SECONDS;
}

function sessionIsExpired(session: RemoteReviewSession) {
  return nowUnixTimestamp() >= sessionExpiresAt(session);
}

export async function deleteByPrefix(storage: DurableObjectStorage, prefix: string) {
  const entries = await storage.list({ prefix });
  const keys = Array.from(entries.keys());
  if (keys.length > 0) {
    await storage.delete(keys);
  }
}

export async function clearSessionSensitiveState(storage: DurableObjectStorage) {
  await storage.delete(TOKEN_STORAGE_KEY);
  await deleteByPrefix(storage, DIRECTORY_PREFIX);
  await deleteByPrefix(storage, FILE_PREFIX);
}

async function markSessionStale(storage: DurableObjectStorage, session: RemoteReviewSession) {
  await clearSessionSensitiveState(storage);

  if (session.status === "stale") {
    return session;
  }

  const nextSession: RemoteReviewSession = {
    ...session,
    status: "stale",
    updatedAt: nowUnixTimestamp(),
    lastError: "Remote review session expired. Prepare the selected PR again.",
  };
  await storage.put(SESSION_STORAGE_KEY, nextSession);
  return nextSession;
}

export async function createOrLoadSession(
  storage: DurableObjectStorage,
  input: ValidatedPrepareSessionInput,
) {
  const expectedId = sessionIdFor(input.repo, input.number, input.headSha);
  const existing = await storage.get<RemoteReviewSession>(SESSION_STORAGE_KEY);

  if (existing) {
    if (existing.id !== expectedId) {
      throw new Error("Session Durable Object name does not match the requested PR revision.");
    }

    if (sessionIsExpired(existing)) {
      await clearSessionSensitiveState(storage);
      const now = nowUnixTimestamp();
      const refreshed: RemoteReviewSession = {
        ...existing,
        status: "prepared",
        fileContext: null,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      };
      await storage.put(SESSION_STORAGE_KEY, refreshed);
      await storage.put(TOKEN_STORAGE_KEY, input.githubToken);
      return refreshed;
    }

    await storage.put(TOKEN_STORAGE_KEY, input.githubToken);
    return existing;
  }

  const now = nowUnixTimestamp();
  const session: RemoteReviewSession = {
    id: expectedId,
    repo: input.repo,
    number: input.number,
    headSha: input.headSha,
    status: "prepared",
    fileContext: null,
    createdAt: now,
    updatedAt: now,
    lastError: null,
  };

  await storage.put(SESSION_STORAGE_KEY, session);
  await storage.put(TOKEN_STORAGE_KEY, input.githubToken);
  return session;
}

export async function loadSession(storage: DurableObjectStorage) {
  const session = await storage.get<RemoteReviewSession>(SESSION_STORAGE_KEY);
  if (!session) {
    throw errorResponse("Remote review session not found.", 404);
  }

  if (sessionIsExpired(session)) {
    await markSessionStale(storage, session);
    throw errorResponse("Remote review session expired. Prepare the selected PR again.", 410);
  }

  return session;
}

export async function loadSessionForGet(storage: DurableObjectStorage) {
  const session = await storage.get<RemoteReviewSession>(SESSION_STORAGE_KEY);
  if (!session) {
    throw errorResponse("Remote review session not found.", 404);
  }

  if (sessionIsExpired(session)) {
    return markSessionStale(storage, session);
  }

  return session;
}

export async function requireGitHubToken(storage: DurableObjectStorage) {
  const token = await storage.get<string>(TOKEN_STORAGE_KEY);
  if (!token) {
    throw new Error("GitHub token is missing for this remote review session.");
  }
  return token;
}

export async function updateSessionStatus(
  storage: DurableObjectStorage,
  input: ValidatedStatusUpdateInput,
) {
  const session = await loadSessionForGet(storage);
  const now = nowUnixTimestamp();
  const nextSession: RemoteReviewSession = {
    ...session,
    status: input.status,
    updatedAt: now,
    lastError: input.status === "failed" ? input.lastError : null,
  };

  await storage.put(SESSION_STORAGE_KEY, nextSession);
  return nextSession;
}
