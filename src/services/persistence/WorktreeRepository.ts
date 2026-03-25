import type {
  PersistedWorktree,
  NewPersistedWorktree,
  PersistedWorktreePatch,
} from "./worktree-schemas.js";

export interface WorktreeRepository {
  listWorktrees(): PersistedWorktree[];
  getWorktree(id: string): PersistedWorktree | undefined;
  insertWorktree(input: NewPersistedWorktree): void;
  updateWorktree(id: string, patch: PersistedWorktreePatch): void;
  /**
   * List all worktrees that belong to a specific repository.
   * This filters by repoRoot for multi-repo support.
   */
  listWorktreesForRepo(repoRoot: string): PersistedWorktree[];
}

export class NoopWorktreeRepository implements WorktreeRepository {
  listWorktrees(): PersistedWorktree[] {
    return [];
  }

  getWorktree(): undefined {
    return undefined;
  }

  insertWorktree(): void {
    // no-op
  }

  updateWorktree(): void {
    // no-op
  }

  listWorktreesForRepo(): PersistedWorktree[] {
    return [];
  }
}
