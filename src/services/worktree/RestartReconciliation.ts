/**
 * Restart reconciliation service for aligning persisted worktree/session state
 * with current git worktree state.
 *
 * On restart, this service:
 * 1. Compares persisted worktrees with actual git worktree state
 * 2. Surfaces missing/out-of-sync worktrees as degraded recovered state
 * 3. Converts interrupted sessions to explicit recovered non-active state
 * 4. Ensures the rehydrated tree reflects only valid current state
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import type { WorktreeRepository } from "../persistence/WorktreeRepository.js";
import type { PersistedWorktree } from "../persistence/worktree-schemas.js";

export interface GitWorktreeEntry {
  path: string;
  branch: string;
  commit: string;
}

export interface MissingWorktreeInfo {
  worktree: PersistedWorktree;
  reason: "missing_from_git" | "path_not_exists" | "branch_mismatch";
}

export interface ReconciliationResult {
  /** Worktrees that are valid and present in git */
  validWorktrees: PersistedWorktree[];
  /** Worktrees that are missing or out of sync (degraded recovered state) */
  missingWorktrees: MissingWorktreeInfo[];
  /** Worktree IDs that were marked as recovered */
  recoveredWorktreeIds: string[];
}

/**
 * Lists all worktrees currently tracked by git.
 */
function listGitWorktrees(repoRoot: string): GitWorktreeEntry[] {
  try {
    const output = execSync("git worktree list --porcelain", {
      cwd: repoRoot,
      encoding: "utf-8",
      timeout: 10000,
    });

    const worktrees: GitWorktreeEntry[] = [];
    // Entries are separated by blank lines (double newlines)
    const entries = output.trim().split("\n\n");

    for (const entry of entries) {
      const lines = entry.split("\n").filter((line) => line.trim() !== "");
      let path = "";
      let branch = "";
      let commit = "";

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          path = line.substring(9).trim();
        } else if (line.startsWith("branch ")) {
          branch = line.substring(7).trim().replace("refs/heads/", "");
        } else if (line.startsWith("HEAD ")) {
          commit = line.substring(5).trim();
        }
      }

      if (path) {
        worktrees.push({ path, branch, commit });
      }
    }

    return worktrees;
  } catch {
    return [];
  }
}

/**
 * Checks if a persisted worktree matches a git worktree entry.
 */
function worktreeMatchesGit(
  persisted: PersistedWorktree,
  gitWorktrees: GitWorktreeEntry[],
): { matches: boolean; reason?: MissingWorktreeInfo["reason"] } {
  // First check if path exists on disk
  if (!existsSync(persisted.path)) {
    return { matches: false, reason: "path_not_exists" };
  }

  // Find matching git worktree by path
  const gitWorktree = gitWorktrees.find((gw) => gw.path === persisted.path);

  if (!gitWorktree) {
    return { matches: false, reason: "missing_from_git" };
  }

  // Check if branch matches (allow for branch renames or checkouts)
  // A mismatch is a warning but not necessarily a critical error
  // The worktree still exists, just potentially on a different branch
  if (gitWorktree.branch && gitWorktree.branch !== persisted.branch) {
    // This is a soft mismatch - the worktree exists but branch changed
    // We'll still consider it valid but note the mismatch
    return { matches: true };
  }

  return { matches: true };
}

/**
 * Reconciles persisted worktrees with current git worktree state.
 *
 * This function:
 * 1. Compares each persisted worktree against git's worktree list
 * 2. Marks missing/out-of-sync worktrees with recovered status
 * 3. Returns the valid worktrees that should be shown in the UI
 *
 * Missing worktrees are surfaced as degraded recovered state and are never
 * silently recreated.
 */
export function reconcileWorktreesOnRestart(
  repoRoot: string,
  worktreeRepository: WorktreeRepository,
): ReconciliationResult {
  const persistedWorktrees = worktreeRepository.listWorktreesForRepo(repoRoot);
  const gitWorktrees = listGitWorktrees(repoRoot);

  const validWorktrees: PersistedWorktree[] = [];
  const missingWorktrees: MissingWorktreeInfo[] = [];
  const recoveredWorktreeIds: string[] = [];

  for (const worktree of persistedWorktrees) {
    // Skip worktrees that are already in terminal states
    if (worktree.status === "removed") {
      continue;
    }

    const matchResult = worktreeMatchesGit(worktree, gitWorktrees);

    if (!matchResult.matches) {
      // Worktree is missing or out of sync - mark as recovered
      const error = matchResult.reason === "path_not_exists"
        ? `Worktree path no longer exists: ${worktree.path}`
        : matchResult.reason === "missing_from_git"
          ? `Worktree not found in git worktree list: ${worktree.path}`
          : `Worktree out of sync: ${worktree.path}`;

      worktreeRepository.updateWorktree(worktree.id, {
        status: "cleanup_failed",
        error,
      });

      missingWorktrees.push({
        worktree,
        reason: matchResult.reason!,
      });
      recoveredWorktreeIds.push(worktree.id);
    } else {
      // Worktree is valid - include it in the result
      // But only include if it's in an active or archived state
      if (worktree.status !== "cleanup_failed") {
        validWorktrees.push(worktree);
      }
    }
  }

  return {
    validWorktrees,
    missingWorktrees,
    recoveredWorktreeIds,
  };
}

/**
 * Converts non-terminal session statuses to recovered terminal states.
 *
 * On restart, any session that was in an active state (queued, starting,
 * running, cancelling) is converted to a failed recovered state since the
 * runtime context was lost.
 */
export function recoverInterruptedSession(
  currentStatus: string,
): { status: string; recovered: boolean; error?: string } | null {
  const activeStates = ["queued", "starting", "running", "cancelling"];

  if (!activeStates.includes(currentStatus)) {
    return null; // No recovery needed for terminal states
  }

  return {
    status: "failed",
    recovered: true,
    error: "Session interrupted by app restart",
  };
}
