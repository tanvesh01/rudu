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
  type: "success" | "failure";
  worktree?: PersistedWorktree;
  error?: string;
}

/**
 * Archives a worktree: preserves the directory on disk, marks it as archived in persistence.
 * Archived worktrees are removed from active default navigation but remain accessible.
 */
export function archiveWorktree(
  worktreeId: string,
  worktreeRepository: WorktreeRepository,
): ArchiveWorktreeResult {
  const worktree = worktreeRepository.getWorktree(worktreeId);

  if (!worktree) {
    return {
      type: "failure",
      error: `Worktree ${worktreeId} not found`,
    };
  }

  // Only active worktrees can be archived
  if (worktree.status !== "active" && worktree.status !== "creating") {
    return {
      type: "failure",
      error: `Cannot archive worktree with status '${worktree.status}'`,
    };
  }

  // Only Rudu-managed worktrees can be archived
  if (!worktree.isRuduManaged) {
    return {
      type: "failure",
      error: "Only Rudu-managed worktrees can be archived",
    };
  }

  // Verify the worktree directory still exists on disk
  if (!pathExists(worktree.path)) {
    return {
      type: "failure",
      error: `Worktree directory does not exist: ${worktree.path}`,
    };
  }

  // Update the worktree status to archived
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
