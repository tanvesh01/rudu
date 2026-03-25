/**
 * Repo-context service for canonical repository detection and git metadata resolution.
 *
 * This module provides the foundation for worktree-first Rudu by:
 * - Resolving the same canonical repo identity from repo root, nested subdirs, or linked worktrees
 * - Explicitly resolving the repository default branch
 * - Exposing supported vs unsupported startup states
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";

/**
 * Result type for repo context detection.
 */
export type RepoContextResult =
  | { type: "supported"; repoRoot: string; defaultBranch: string }
  | { type: "unsupported"; reason: string };

/**
 * Detects git repository context from a starting directory.
 *
 * This function resolves the canonical repository identity and default branch
 * regardless of whether launched from:
 * - The repository root
 * - A nested subdirectory within the repo
 * - A linked sibling worktree
 *
 * The canonical repo identity is based on the git common directory (shared across
 * all worktrees of the same repository), ensuring consistent persistence scoping.
 *
 * @param startDir - Directory to start searching from (defaults to process.cwd())
 * @returns RepoContextResult indicating supported repo or unsupported state with reason
 */
export function detectRepoContext(
  startDir: string = process.cwd(),
): RepoContextResult {
  try {
    // First, check if we're in a git repository at all
    const repoRoot = resolveRepoRoot(startDir);
    if (!repoRoot) {
      return {
        type: "unsupported",
        reason: "Not a git repository (or any of the parent directories)",
      };
    }

    // Get the git common directory for canonical identity
    // This is the same for main repo and all linked worktrees
    const gitCommonDir = resolveGitCommonDir(startDir);

    // Resolve the default branch from git metadata
    const defaultBranch = resolveDefaultBranch(gitCommonDir ?? repoRoot);
    if (!defaultBranch) {
      return {
        type: "unsupported",
        reason: "Could not determine repository default branch",
      };
    }

    return {
      type: "supported",
      repoRoot,
      defaultBranch,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      type: "unsupported",
      reason: `Git error: ${message}`,
    };
  }
}

/**
 * Resolves the working tree root from any location within or linked to a repo.
 *
 * Uses `git rev-parse --show-toplevel` which handles:
 * - Regular repositories (from any nested subdirectory)
 * - Linked worktrees (returns the worktree path, not the main repo root)
 *
 * @param startDir - Directory to start from
 * @returns Absolute path to working tree root, or null if not in a git repo
 */
function resolveRepoRoot(startDir: string): string | null {
  try {
    const result = execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      encoding: "utf-8",
      timeout: 5000,
    });
    return resolve(result.trim());
  } catch {
    return null;
  }
}

/**
 * Resolves the git common directory shared across all worktrees of a repository.
 *
 * Uses `git rev-parse --git-common-dir` which returns the same path for:
 * - The main repository
 * - Any linked worktree
 *
 * This provides the canonical repository identity for persistence scoping.
 *
 * @param startDir - Directory to start from
 * @returns Absolute path to git common directory, or null if not in a git repo
 */
function resolveGitCommonDir(startDir: string): string | null {
  try {
    const result = execSync("git rev-parse --git-common-dir", {
      cwd: startDir,
      encoding: "utf-8",
      timeout: 5000,
    });
    const commonDir = result.trim();
    // The result may be relative (e.g., ".git") or absolute
    return resolve(startDir, commonDir);
  } catch {
    return null;
  }
}

/**
 * Resolves the default branch for a repository.
 *
 * Priority order:
 * 1. `origin/HEAD` symref (e.g., origin/main, origin/master)
 * 2. Common default branch names (main, master) if they exist as local branches
 * 3. Falls back to null if no default can be determined
 *
 * @param repoRoot - Path to the repository root
 * @returns The default branch name, or null if unresolved
 */
function resolveDefaultBranch(repoRoot: string): string | null {
  // Try to get the remote HEAD reference (e.g., origin/HEAD -> origin/main)
  try {
    const remoteHead = execSync(
      "git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo ''",
      {
        cwd: repoRoot,
        encoding: "utf-8",
        timeout: 5000,
      },
    );

    const trimmed = remoteHead.trim();
    if (trimmed && trimmed.startsWith("refs/remotes/origin/")) {
      // Extract branch name from refs/remotes/origin/<branch>
      const branch = trimmed.replace("refs/remotes/origin/", "");
      if (branch && branch !== "HEAD") {
        return branch;
      }
    }
  } catch {
    // Continue to fallback
  }

  // Fallback: check for common default branch names
  const commonDefaults = ["main", "master"];
  for (const branch of commonDefaults) {
    try {
      execSync(`git show-ref --verify --quiet refs/heads/${branch}`, {
        cwd: repoRoot,
        timeout: 1000,
      });
      return branch;
    } catch {
      // Branch doesn't exist, try next
    }
  }

  return null;
}

/**
 * Gets the path to the git directory for a repository.
 *
 * Handles both regular repos (.git directory) and linked worktrees (.git file).
 *
 * @param repoRoot - Path to the repository root
 * @returns Path to the git directory, or null if not found
 */
export function resolveGitDir(repoRoot: string): string | null {
  const gitPath = join(repoRoot, ".git");

  if (!existsSync(gitPath)) {
    return null;
  }

  // If .git is a directory, return it directly
  let isDir = false;
  try {
    const { lstatSync } = require("fs");
    isDir = lstatSync(gitPath).isDirectory();
  } catch {
    isDir = false;
  }

  if (isDir) {
    return gitPath;
  }

  // If .git is a file (linked worktree), read the gitdir reference
  try {
    const content = readFileSync(gitPath, "utf-8");
    const match = content.match(/gitdir:\s*(.+)/);
    if (match && match[1]) {
      const gitdir = match[1].trim();
      // Resolve relative to repo root if needed
      return resolve(repoRoot, gitdir);
    }
  } catch {
    // Fall through
  }

  return null;
}

/**
 * Type guard to check if a repo context result is supported.
 */
export function isSupportedRepo(
  result: RepoContextResult,
): result is { type: "supported"; repoRoot: string; defaultBranch: string } {
  return result.type === "supported";
}
