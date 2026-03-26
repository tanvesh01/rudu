// src/services/persistence/JsonlSessionRepository.ts
// JSONL-based session persistence for multi-project support
// Stores metadata in ~/.rudu/sessions.jsonl

import { existsSync, mkdirSync } from "fs";
import { appendFile, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type {
  PersistedSession,
  NewPersistedSession,
  PersistedSessionPatch,
  RecoveryPatch,
} from "./types.js";
import { parseJsonlLine, serializeSession } from "./schemas.js";

const SCHEMA_VERSION = 1;

export interface JsonlSessionRepositoryOptions {
  dataDir?: string;
  projectRoot?: string;
  now?: () => number;
}

/**
 * Async JSONL session repository.
 * This is the underlying implementation used by SyncJsonlSessionRepository.
 * Direct usage should prefer SyncJsonlSessionRepository for SessionManager compatibility.
 */
export class JsonlSessionRepository {
  private dataDir: string;
  private indexPath: string;
  private projectRoot: string;
  private now: () => number;
  private cache = new Map<string, PersistedSession>();
  private cacheValid = false;

  constructor(options: JsonlSessionRepositoryOptions = {}) {
    this.dataDir = options.dataDir ?? join(homedir(), ".rudu");
    this.indexPath = join(this.dataDir, "sessions.jsonl");
    this.projectRoot = options.projectRoot ?? this.detectProjectRoot();
    this.now = options.now ?? (() => Date.now());

    // Ensure directory exists
    this.ensureDir();
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

  private isInProjectScope(candidateRoot: string): boolean {
    if (!candidateRoot) return false;
    return (
      candidateRoot === this.projectRoot ||
      candidateRoot.startsWith(`${this.projectRoot}/`)
    );
  }

  private detectProjectRoot(): string {
    // Try to find git repo root from current working directory
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

  private async loadLines(): Promise<PersistedSession[]> {
    if (!existsSync(this.indexPath)) {
      return [];
    }

    const content = await readFile(this.indexPath, "utf-8").catch(() => "");
    if (!content.trim()) {
      return [];
    }

    const lines = content.split("\n").filter((line) => line.trim());
    const records: PersistedSession[] = [];

    for (const line of lines) {
      const record = parseJsonlLine(line);
      if (record && record.schemaVersion === SCHEMA_VERSION) {
        records.push(record);
      }
    }

    return records;
  }

  private foldRecords(records: PersistedSession[]): Map<string, PersistedSession> {
    // Keep only the latest record per sessionId (last line wins for same updatedAt)
    const latest = new Map<string, PersistedSession>();

    for (const record of records) {
      const existing = latest.get(record.id);
      if (!existing || record.updatedAt >= existing.updatedAt) {
        latest.set(record.id, record);
      }
    }

    return latest;
  }

  private async rebuildCache(): Promise<void> {
    const lines = await this.loadLines();
    const folded = this.foldRecords(lines);
    this.cache.clear();

    for (const [_, record] of folded) {
      // repoRoot is the canonical scope for worktree sessions.
      // projectRoot is retained as a compatibility fallback.
      const projectRoot = record.repoRoot ?? record.projectRoot ?? "";
      if (this.isInProjectScope(projectRoot)) {
        this.cache.set(record.id, record);
      }
    }

    this.cacheValid = true;
  }

  private async ensureCache(): Promise<void> {
    if (!this.cacheValid) {
      await this.rebuildCache();
    }
  }

  private async appendRecord(record: PersistedSession): Promise<void> {
    this.ensureDir();
    const line = serializeSession(record);
    await appendFile(this.indexPath, line, "utf-8");

    // Update cache
    this.cache.set(record.id, record);
  }

  async listSessions(): Promise<PersistedSession[]> {
    await this.ensureCache();
    return Array.from(this.cache.values()).sort((a, b) => a.queuedAt - b.queuedAt);
  }

  /** Synchronous version for SyncJsonlSessionRepository wrapper */
  listSessionsSync(): PersistedSession[] {
    return Array.from(this.cache.values()).sort((a, b) => a.queuedAt - b.queuedAt);
  }

  getSession(id: string): PersistedSession | undefined {
    // Synchronous for cached data
    return this.cache.get(id);
  }

  async insertSession(input: NewPersistedSession): Promise<void> {
    const now = this.now();
    const session: PersistedSession = {
      ...input,
      schemaVersion: SCHEMA_VERSION,
      // Scope records to canonical repo root when available.
      projectRoot: input.repoRoot ?? this.projectRoot,
      createdAt: now,
      updatedAt: now,
    };

    await this.appendRecord(session);
  }

  async updateSession(id: string, patch: PersistedSessionPatch): Promise<void> {
    await this.ensureCache();
    const existing = this.cache.get(id);
    if (!existing) {
      return;
    }

    const now = this.now();
    const updated: PersistedSession = {
      ...existing,
      ...patch,
      id: existing.id, // Ensure ID is preserved
      schemaVersion: existing.schemaVersion,
      projectRoot: existing.projectRoot,
      createdAt: existing.createdAt,
      updatedAt: now,
    };

    await this.appendRecord(updated);
  }

  async markRecovered(id: string, patch: RecoveryPatch): Promise<void> {
    await this.updateSession(id, {
      status: patch.status,
      recovered: patch.recovered,
      lastError: patch.lastError,
      worktreeStatus: patch.worktreeStatus,
    });
  }

  listSessionsByWorktree(worktreeId: string): PersistedSession[] {
    return Array.from(this.cache.values())
      .filter((session) => session.worktreeId === worktreeId)
      .sort((a, b) => a.queuedAt - b.queuedAt);
  }

  // For tests: clear the cache
  invalidateCache(): void {
    this.cacheValid = false;
    this.cache.clear();
  }

  // Get the project root for this repository
  getProjectRoot(): string {
    return this.projectRoot;
  }
}

// Simple in-memory session repository for testing - implements SessionRepository interface
export class InMemorySessionRepository {
  private sessions = new Map<string, PersistedSession>();

  listSessions(): PersistedSession[] {
    return Array.from(this.sessions.values()).sort((a, b) => a.queuedAt - b.queuedAt);
  }

  getSession(id: string): PersistedSession | undefined {
    return this.sessions.get(id);
  }

  insertSession(input: NewPersistedSession): void {
    const now = Date.now();
    const session: PersistedSession = {
      ...input,
      schemaVersion: 1,
      projectRoot: input.repoRoot ?? process.cwd(),
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
  }

  updateSession(id: string, patch: PersistedSessionPatch): void {
    const existing = this.sessions.get(id);
    if (!existing) return;

    const updated: PersistedSession = {
      ...existing,
      ...patch,
      id: existing.id,
      schemaVersion: existing.schemaVersion,
      projectRoot: existing.projectRoot,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    this.sessions.set(id, updated);
  }

  markRecovered(id: string, patch: RecoveryPatch): void {
    this.updateSession(id, {
      status: patch.status,
      recovered: patch.recovered,
      lastError: patch.lastError,
      worktreeStatus: patch.worktreeStatus,
    });
  }

  listSessionsByWorktree(worktreeId: string): PersistedSession[] {
    return Array.from(this.sessions.values())
      .filter((session) => session.worktreeId === worktreeId)
      .sort((a, b) => a.queuedAt - b.queuedAt);
  }

  clear(): void {
    this.sessions.clear();
  }
}

// Note: InMemorySessionRepository structurally implements SessionRepository interface
