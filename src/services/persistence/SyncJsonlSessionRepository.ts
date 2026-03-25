// src/services/persistence/SyncJsonlSessionRepository.ts
// Synchronous JSONL session repository with synchronous loading on startup

import { existsSync, readFileSync, mkdirSync, appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { SessionRepository } from "./SessionRepository.js";
import type {
  PersistedSession,
  NewPersistedSession,
  PersistedSessionPatch,
  RecoveryPatch,
} from "./types.js";
import { parseJsonlLine, serializeSession } from "./schemas.js";

export interface SyncJsonlSessionRepositoryOptions {
  dataDir?: string;
  projectRoot?: string;
}

/**
 * Synchronous JSONL session repository.
 * Loads sessions synchronously on startup and writes updates synchronously.
 */
export class SyncJsonlSessionRepository implements SessionRepository {
  private dataDir: string;
  private indexPath: string;
  private projectRoot: string;
  private syncCache = new Map<string, PersistedSession>();

  constructor(options: SyncJsonlSessionRepositoryOptions = {}) {
    this.dataDir = options.dataDir ?? join(homedir(), ".rudu");
    this.indexPath = join(this.dataDir, "sessions.jsonl");
    this.projectRoot = options.projectRoot ?? this.detectProjectRoot();

    // Ensure directory exists
    this.ensureDir();

    // Synchronously load and parse JSONL on startup
    this.loadFromDisk();
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) {
      try {
        mkdirSync(this.dataDir, { recursive: true });
      } catch {
        // Directory may already exist
      }
    }
  }

  private detectProjectRoot(): string {
    let cwd = process.cwd();
    while (cwd !== "/") {
      if (existsSync(join(cwd, ".git"))) {
        return cwd;
      }
      const parent = cwd.substring(0, cwd.lastIndexOf("/"));
      if (parent === cwd) break;
      cwd = parent;
    }
    return process.cwd();
  }

  private loadFromDisk(): void {
    if (!existsSync(this.indexPath)) {
      return;
    }

    try {
      const content = readFileSync(this.indexPath, "utf-8");
      if (!content.trim()) {
        return;
      }

      const lines = content.split("\n").filter((line) => line.trim());
      const records: PersistedSession[] = [];

      for (const line of lines) {
        const record = parseJsonlLine(line);
        if (record && record.schemaVersion === 1) {
          records.push(record);
        }
      }

      // Fold records to get latest per sessionId
      const folded = this.foldRecords(records);

      // Filter by projectRoot and populate cache
      for (const [_, record] of folded) {
        const recordProjectRoot = record.repoRoot ?? record.effectiveCwd ?? "";
        if (
          recordProjectRoot === this.projectRoot ||
          recordProjectRoot.startsWith(this.projectRoot)
        ) {
          this.syncCache.set(record.id, record);
        }
      }
    } catch {
      // File read errors are silently ignored - empty cache is fine
    }
  }

  private foldRecords(records: PersistedSession[]): Map<string, PersistedSession> {
    const latest = new Map<string, PersistedSession>();
    for (const record of records) {
      const existing = latest.get(record.id);
      if (!existing || record.updatedAt >= existing.updatedAt) {
        latest.set(record.id, record);
      }
    }
    return latest;
  }

  private appendRecord(record: PersistedSession): void {
    this.ensureDir();
    const line = serializeSession(record);
    try {
      appendFileSync(this.indexPath, line, "utf-8");
    } catch (error) {
      console.error(`[SyncJsonlSessionRepository] Failed to write session ${record.id}:`, error);
    }
  }

  listSessions(): PersistedSession[] {
    return Array.from(this.syncCache.values()).sort((a, b) => a.queuedAt - b.queuedAt);
  }

  getSession(id: string): PersistedSession | undefined {
    return this.syncCache.get(id);
  }

  insertSession(input: NewPersistedSession): void {
    const now = Date.now();
    const session: PersistedSession = {
      ...input,
      schemaVersion: 1,
      projectRoot: input.repoRoot ?? input.effectiveCwd ?? this.projectRoot,
      createdAt: now,
      updatedAt: now,
    };
    this.syncCache.set(session.id, session);
    this.appendRecord(session);
  }

  updateSession(id: string, patch: PersistedSessionPatch): void {
    const existing = this.syncCache.get(id);
    if (!existing) return;

    const now = Date.now();
    const updated: PersistedSession = {
      ...existing,
      ...patch,
      id: existing.id,
      schemaVersion: existing.schemaVersion,
      projectRoot: existing.projectRoot,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
    this.syncCache.set(id, updated);
    this.appendRecord(updated);
  }

  markRecovered(id: string, patch: RecoveryPatch): void {
    this.updateSession(id, {
      status: patch.status,
      recovered: patch.recovered,
      lastError: patch.lastError,
      worktreeStatus: patch.worktreeStatus,
    });
  }
}
