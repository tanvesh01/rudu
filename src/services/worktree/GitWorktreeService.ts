/**
 * Git worktree creation service with collision-safe naming.
 *
 * This service handles:
 * - Deterministic branch/path name generation from worktree titles
 * - Collision detection and deduplication
 * - Git worktree creation from the repository default branch
 * - Error handling with recoverable state
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import type { WorktreeRepository } from "../persistence/WorktreeRepository.js";
import type { PersistedWorktree } from "../persistence/worktree-schemas.js";

export interface CreateWorktreeInput {
  title: string;
  repoRoot: string;
  defaultBranch: string;
}

export interface CreateWorktreeSuccess {
  type: "success";
  worktree: PersistedWorktree;
}

export interface CreateWorktreeFailure {
  type: "failure";
  error: string;
  recoverable: boolean;
}

export type CreateWorktreeResult = CreateWorktreeSuccess | CreateWorktreeFailure;

/**
 * Derives a valid git branch name from a worktree title.
 * - Converts to lowercase
 * - Replaces spaces and special chars with hyphens
 * - Removes invalid characters
 * - Prefixes with "rudu/" to namespace Rudu-managed branches
 */
export function deriveBranchName(title: string): string {
  const normalized = title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `rudu/${normalized}`;
}

/**
 * Derives a sibling directory path for the worktree.
 * The worktree is created as a sibling to the repo root.
 */
export function deriveSiblingPath(repoRoot: string, title: string): string {
  const parentDir = repoRoot.substring(0, repoRoot.lastIndexOf("/")) || repoRoot;
  const normalizedTitle = title
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${parentDir}/${normalizedTitle}`;
}

/**
 * Checks if a branch exists in the repository.
 */
function branchExists(repoRoot: string, branch: string): boolean {
  try {
    execSync(`git show-ref --verify --quiet refs/heads/${branch}`, {
      cwd: repoRoot,
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a path already exists on disk.
 */
function pathExists(path: string): boolean {
  return existsSync(path);
}

/**
 * Finds a non-colliding branch name by appending a counter.
 */
function findUniqueBranch(repoRoot: string, baseBranch: string): string {
  if (!branchExists(repoRoot, baseBranch)) {
    return baseBranch;
  }

  let counter = 1;
  let candidate = `${baseBranch}-${counter}`;

  while (branchExists(repoRoot, candidate)) {
    counter++;
    candidate = `${baseBranch}-${counter}`;
  }

  return candidate;
}

/**
 * Finds a non-colliding path by appending a counter.
 */
function findUniquePath(basePath: string): string {
  if (!pathExists(basePath)) {
    return basePath;
  }

  let counter = 1;
  let candidate = `${basePath}-${counter}`;

  while (pathExists(candidate)) {
    counter++;
    candidate = `${basePath}-${counter}`;
  }

  return candidate;
}

/**
 * Creates a git worktree from the repository default branch.
 *
 * This function:
 * 1. Generates deterministic branch and path names from the title
 * 2. Handles collisions by appending numeric suffixes
 * 3. Creates a new branch from the default branch
 * 4. Creates a linked worktree at the sibling path
 * 5. Persists the worktree record
 */
export function createWorktree(
  input: CreateWorktreeInput,
  worktreeRepository: WorktreeRepository,
): CreateWorktreeResult {
  const { title, repoRoot, defaultBranch } = input;

  // Validate inputs
  if (!title.trim()) {
    return {
      type: "failure",
      error: "Title is required",
      recoverable: true,
    };
  }

  if (title.trim().length < 2) {
    return {
      type: "failure",
      error: "Title must be at least 2 characters",
      recoverable: true,
    };
  }

  // Generate base branch and path names
  const baseBranch = deriveBranchName(title);
  const basePath = deriveSiblingPath(repoRoot, title);

  // Find collision-free names
  const finalBranch = findUniqueBranch(repoRoot, baseBranch);
  const finalPath = findUniquePath(basePath);

  try {
    // Verify we're in a git repo and default branch exists
    try {
      execSync(`git show-ref --verify --quiet refs/heads/${defaultBranch}`, {
        cwd: repoRoot,
        timeout: 5000,
      });
    } catch {
      return {
        type: "failure",
        error: `Default branch '${defaultBranch}' not found in repository`,
        recoverable: true,
      };
    }

    // Create the worktree with a new branch from the default branch
    // git worktree add -b <new-branch> <path> <base-branch>
    execSync(
      `git worktree add -b ${finalBranch} ${finalPath} ${defaultBranch}`,
      {
        cwd: repoRoot,
        encoding: "utf-8",
        timeout: 30000,
      },
    );

    // Create the worktree record
    const worktreeId = crypto.randomUUID();
    const now = Date.now();

    const worktree: PersistedWorktree = {
      schemaVersion: 1,
      projectRoot: repoRoot,
      id: worktreeId,
      title: title.trim(),
      path: finalPath,
      branch: finalBranch,
      status: "active",
      repoRoot,
      isRuduManaged: true,
      createdAt: now,
      updatedAt: now,
    };

    // Persist the worktree
    worktreeRepository.insertWorktree({
      id: worktree.id,
      title: worktree.title,
      path: worktree.path,
      branch: worktree.branch,
      status: worktree.status,
      repoRoot: worktree.repoRoot,
      isRuduManaged: worktree.isRuduManaged,
    });

    return {
      type: "success",
      worktree,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Determine if the error is recoverable (e.g., user can retry with different title)
    const recoverable =
      message.includes("already exists") ||
      message.includes("is already checked out") ||
      message.includes("not a git repository") ||
      message.includes("permission denied") ||
      message.includes("could not create directory");

    return {
      type: "failure",
      error: `Failed to create worktree: ${message}`,
      recoverable,
    };
  }
}

/**
 * Previews the branch and path that would be created for a title.
 * Returns the derived names (before collision handling) and indicates if collisions exist.
 */
export function previewWorktreeNames(
  repoRoot: string,
  title: string,
): {
  branch: string;
  path: string;
  branchExists: boolean;
  pathExists: boolean;
} {
  const branch = deriveBranchName(title);
  const path = deriveSiblingPath(repoRoot, title);

  return {
    branch,
    path,
    branchExists: branchExists(repoRoot, branch),
    pathExists: pathExists(path),
  };
}

export interface ArchiveWorktreeResult {
  type: "success" | "failure" | "blocked";
  worktree?: PersistedWorktree;
  error?: string;
}

export interface DeleteWorktreeResult {
  type: "success" | "failure" | "blocked";
  worktree?: PersistedWorktree;
  error?: string;
}

/**
 * Checks if a session is in an active (non-terminal) state.
 */
function isSessionActive(status: string): boolean {
  return status === "queued" || status === "starting" || status === "running" || status === "cancelling";
}

/**
 * Archives a worktree: removes the linked git worktree from disk and Git,
 * cancels any active sessions, and marks it as archived in persistence.
 * Archived worktrees are removed from active default navigation but their
 * history/metadata is preserved.
 */
export function archiveWorktree(
  worktreeId: string,
  worktreeRepository: WorktreeRepository,
  repoRoot?: string,
  sessionManager?: {
    listSessions: () => { id: string; worktreeId?: string; status: string }[];
    cancelSession: (id: string) => boolean;
  },
): ArchiveWorktreeResult {
  const worktree = worktreeRepository.getWorktree(worktreeId);

  if (!worktree) {
    return {
      type: "failure",
      error: `Worktree ${worktreeId} not found`,
    };
  }

  // Cannot archive an already archived worktree
  if (worktree.status === "archived") {
    return {
      type: "failure",
      error: `Worktree has already been archived`,
    };
  }

  // Cannot archive an already removed worktree
  if (worktree.status === "removed") {
    return {
      type: "failure",
      error: "Worktree has already been removed",
    };
  }

  // Only Rudu-managed worktrees can be archived
  if (!worktree.isRuduManaged) {
    return {
      type: "failure",
      error: "Only Rudu-managed worktrees can be archived",
    };
  }

  // Check for active sessions that need cleanup (similar to delete)
  if (sessionManager) {
    const allSessions = sessionManager.listSessions();
    const worktreeSessions = allSessions.filter(
      (s) => s.worktreeId === worktreeId
    );
    const activeSessions = worktreeSessions.filter((s) => isSessionActive(s.status));

    // If there are active sessions, we need to cancel them first
    if (activeSessions.length > 0) {
      // Update status to indicate cleanup is in progress
      worktreeRepository.updateWorktree(worktreeId, {
        status: "cleanup_pending",
      });

      // Cancel all active sessions
      for (const session of activeSessions) {
        sessionManager.cancelSession(session.id);
      }

      // Return blocked state - caller should retry after sessions complete
      return {
        type: "blocked",
        error: `Cannot archive worktree while ${activeSessions.length} session(s) are active. Sessions are being cancelled.`,
      };
    }
  }

  // For worktrees in "creating" status, the directory might not exist as a git worktree yet
  // so we just mark it as archived without trying to remove it
  const worktreeExistsOnDisk = pathExists(worktree.path);

  if (worktree.status !== "creating" && worktreeExistsOnDisk && repoRoot) {
    try {
      // Remove the git worktree using git worktree remove
      // This removes the worktree entry from git and the directory
      execSync(`git worktree remove "${worktree.path}"`, {
        cwd: repoRoot,
        encoding: "utf-8",
        timeout: 30000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Record the archive failure for recovery
      worktreeRepository.updateWorktree(worktreeId, {
        status: "archive_failed",
        error: `Failed to archive worktree: ${message}`,
      });

      return {
        type: "failure",
        error: `Failed to archive worktree: ${message}`,
      };
    }
  }

  // Mark the worktree as archived in persistence
  // This preserves the history/metadata while removing it from active navigation
  const now = Date.now();
  worktreeRepository.updateWorktree(worktreeId, {
    status: "archived",
    archivedAt: now,
  });

  const updatedWorktree = worktreeRepository.getWorktree(worktreeId);

  return {
    type: "success",
    worktree: updatedWorktree,
  };
}

/**
 * Deletes a worktree: removes the linked git worktree, cancels any active sessions,
 * and marks the worktree as removed in persistence.
 *
 * This function:
 * 1. Validates the worktree exists and is Rudu-managed
 * 2. Cancels any queued/running sessions associated with this worktree
 * 3. Removes the git worktree (via `git worktree remove`)
 * 4. Marks the worktree as removed in persistence
 *
 * If deletion fails, it records a cleanup_failed state for recovery.
 */
export function deleteWorktree(
  worktreeId: string,
  worktreeRepository: WorktreeRepository,
  sessionManager: {
    listSessions: () => { id: string; worktreeId?: string; status: string }[];
    cancelSession: (id: string) => boolean;
  },
): DeleteWorktreeResult {
  const worktree = worktreeRepository.getWorktree(worktreeId);

  if (!worktree) {
    return {
      type: "failure",
      error: `Worktree ${worktreeId} not found`,
    };
  }

  // Only Rudu-managed worktrees can be deleted
  if (!worktree.isRuduManaged) {
    return {
      type: "failure",
      error: "Only Rudu-managed worktrees can be deleted",
    };
  }

  // Cannot delete an already removed worktree
  if (worktree.status === "removed") {
    return {
      type: "failure",
      error: "Worktree has already been removed",
    };
  }

  // Check for active sessions that need cleanup
  const allSessions = sessionManager.listSessions();
  const worktreeSessions = allSessions.filter(
    (s) => s.worktreeId === worktreeId
  );
  const activeSessions = worktreeSessions.filter((s) => isSessionActive(s.status));

  // If there are active sessions, we need to cancel them first
  // This may block briefly while sessions transition to terminal states
  if (activeSessions.length > 0) {
    // Update status to indicate cleanup is in progress
    worktreeRepository.updateWorktree(worktreeId, {
      status: "cleanup_pending",
    });

    // Cancel all active sessions
    for (const session of activeSessions) {
      sessionManager.cancelSession(session.id);
    }

    // Return blocked state - caller should retry after sessions complete
    return {
      type: "blocked",
      error: `Cannot delete worktree while ${activeSessions.length} session(s) are active. Sessions are being cancelled.`,
    };
  }

  try {
    // Verify the worktree directory exists before attempting removal
    const worktreeExistsOnDisk = pathExists(worktree.path);

    if (worktreeExistsOnDisk) {
      // Remove the git worktree using git worktree remove
      // This removes the worktree entry from git and the directory
      execSync(`git worktree remove "${worktree.path}"`, {
        cwd: worktree.repoRoot,
        encoding: "utf-8",
        timeout: 30000,
      });
    }

    // Mark the worktree as removed in persistence
    const now = Date.now();
    worktreeRepository.updateWorktree(worktreeId, {
      status: "removed",
      removedAt: now,
    });

    const updatedWorktree = worktreeRepository.getWorktree(worktreeId);

    return {
      type: "success",
      worktree: updatedWorktree,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Record the cleanup failure for recovery
    worktreeRepository.updateWorktree(worktreeId, {
      status: "cleanup_failed",
      error: `Failed to delete worktree: ${message}`,
    });

    return {
      type: "failure",
      error: `Failed to delete worktree: ${message}`,
    };
  }
}
