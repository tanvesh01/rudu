import type {
  PersistedSession,
  NewPersistedSession,
  PersistedSessionPatch,
  RecoveryPatch,
} from "./types.js";

// Re-export JSONL repository for new implementations
export {
  JsonlSessionRepository,
  InMemorySessionRepository,
} from "./JsonlSessionRepository.js";

export { SyncJsonlSessionRepository } from "./SyncJsonlSessionRepository.js";

export interface SessionRepository {
  listSessions(): PersistedSession[];
  getSession(id: string): PersistedSession | undefined;
  insertSession(input: NewPersistedSession): void;
  updateSession(id: string, patch: PersistedSessionPatch): void;
  markRecovered(id: string, patch: RecoveryPatch): void;
  /**
   * List sessions that belong to a specific worktree.
   * Returns sessions with matching worktreeId.
   */
  listSessionsByWorktree(worktreeId: string): PersistedSession[];
}

export class NoopSessionRepository implements SessionRepository {
  listSessions(): PersistedSession[] {
    return [];
  }

  getSession(): undefined {
    return undefined;
  }

  insertSession(): void {
    // no-op
  }

  updateSession(): void {
    // no-op
  }

  markRecovered(): void {
    // no-op
  }

  listSessionsByWorktree(): PersistedSession[] {
    return [];
  }
}
