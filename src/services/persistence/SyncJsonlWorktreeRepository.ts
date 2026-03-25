// src/services/persistence/SyncJsonlWorktreeRepository.ts
// Synchronous JSONL worktree repository with synchronous loading on startup

import { existsSync, readFileSync, mkdirSync, appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { WorktreeRepository } from "./WorktreeRepository.js";
import type {
  PersistedWorktree,
  NewPersistedWorktree,
  PersistedWorktreePatch,
} from "./worktree-schemas.js";
import { parseWorktreeJsonlLine, serializeWorktree } from "./worktree-schemas.js";

export interface SyncJsonlWorktreeRepositoryOptions {
  dataDir?: string;
  projectRoot?: string;
}

/**
 * Synchronous JSONL worktree repository.
 * Loads worktrees synchronously on startup and writes updates synchronously.
 */
export class SyncJsonlWorktreeRepository implements WorktreeRepository {
  private dataDir: string;
  private indexPath: string;
  private projectRoot: string;
  private syncCache = new Map<string, PersistedWorktree>();

  constructor(options: SyncJsonlWorktreeRepositoryOptions = {}) {
    this.dataDir = options.dataDir ?? join(homedir(), ".rudu");
    this.indexPath = join(this.dataDir, "worktrees.jsonl");
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
      const records: PersistedWorktree[] = [];

      for (const line of lines) {
        const record = parseWorktreeJsonlLine(line);
        if (record && record.schemaVersion === 1) {
          records.push(record);
        }
      }

      // Fold records to get latest per worktreeId
      const folded = this.foldRecords(records);

      // Filter by projectRoot and populate cache
      for (const [_, record] of folded) {
        // Use projectRoot for filtering (this is the canonical repo root set during insert)
        const recordProjectRoot = record.projectRoot ?? "";
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

  private foldRecords(records: PersistedWorktree[]): Map<string, PersistedWorktree> {
    const latest = new Map<string, PersistedWorktree>();
    for (const record of records) {
      const existing = latest.get(record.id);
      if (!existing || record.updatedAt >= existing.updatedAt) {
        latest.set(record.id, record);
      }
    }
    return latest;
  }

  private appendRecord(record: PersistedWorktree): void {
    this.ensureDir();
    const line = serializeWorktree(record);
    try {
      appendFileSync(this.indexPath, line, "utf-8");
    } catch (error) {
      console.error(`[SyncJsonlWorktreeRepository] Failed to write worktree ${record.id}:`, error);
    }
  }

  listWorktrees(): PersistedWorktree[] {
    return Array.from(this.syncCache.values()).sort(
      (a, b) => a.createdAt - b.createdAt
    );
  }

  listWorktreesForRepo(repoRoot: string): PersistedWorktree[] {
    return this.listWorktrees().filter(
      (worktree) =>
        worktree.repoRoot === repoRoot ||
        worktree.repoRoot.startsWith(repoRoot)
    );
  }

  getWorktree(id: string): PersistedWorktree | undefined {
    return this.syncCache.get(id);
  }

  insertWorktree(input: NewPersistedWorktree): void {
    const now = Date.now();
    const worktree: PersistedWorktree = {
      ...input,
      schemaVersion: 1,
      projectRoot: input.repoRoot ?? this.projectRoot,
      createdAt: now,
      updatedAt: now,
    };
    this.syncCache.set(worktree.id, worktree);
    this.appendRecord(worktree);
  }

  updateWorktree(id: string, patch: PersistedWorktreePatch): void {
    const existing = this.syncCache.get(id);
    if (!existing) return;

    const now = Date.now();
    const updated: PersistedWorktree = {
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

  /**
   * Get the project root for this repository.
   */
  getProjectRoot(): string {
    return this.projectRoot;
  }

  /**
   * For tests: clear the cache.
   */
  invalidateCache(): void {
    this.syncCache.clear();
  }
}

// Simple in-memory worktree repository for testing
export class InMemoryWorktreeRepository implements WorktreeRepository {
  private worktrees = new Map<string, PersistedWorktree>();

  listWorktrees(): PersistedWorktree[] {
    return Array.from(this.worktrees.values()).sort(
      (a, b) => a.createdAt - b.createdAt
    );
  }

  listWorktreesForRepo(repoRoot: string): PersistedWorktree[] {
    return this.listWorktrees().filter(
      (worktree) =>
        worktree.repoRoot === repoRoot ||
        worktree.repoRoot.startsWith(repoRoot)
    );
  }

  getWorktree(id: string): PersistedWorktree | undefined {
    return this.worktrees.get(id);
  }

  insertWorktree(input: NewPersistedWorktree): void {
    const now = Date.now();
    const worktree: PersistedWorktree = {
      ...input,
      schemaVersion: 1,
      projectRoot: input.repoRoot ?? process.cwd(),
      createdAt: now,
      updatedAt: now,
    };
    this.worktrees.set(worktree.id, worktree);
  }

  updateWorktree(id: string, patch: PersistedWorktreePatch): void {
    const existing = this.worktrees.get(id);
    if (!existing) return;

    const updated: PersistedWorktree = {
      ...existing,
      ...patch,
      id: existing.id,
      schemaVersion: existing.schemaVersion,
      projectRoot: existing.projectRoot,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    this.worktrees.set(id, updated);
  }

  clear(): void {
    this.worktrees.clear();
  }
}
