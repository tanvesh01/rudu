/**
 * Domain model for Rudu-managed git worktrees.
 *
 * Worktrees are first-class durable entities with their own lifecycle,
 * independent of the sessions that run within them.
 */

/**
 * Lifecycle states for a worktree.
 */
export type WorktreeLifecycleStatus =
  | "creating"     // Worktree is being created
  | "active"       // Worktree is ready and active
  | "archived"     // Worktree is archived (worktree removed, history preserved)
  | "archive_failed"  // Archive operation failed
  | "cleanup_pending"  // Deletion/cleanup is pending
  | "cleanup_failed"   // Cleanup/deletion failed
  | "removed";     // Worktree has been removed

/**
 * Terminal lifecycle states after which no further state changes occur.
 */
export type TerminalWorktreeStatus = Extract<
  WorktreeLifecycleStatus,
  "removed"
>;

/**
 * Full representation of a worktree in the domain.
 */
export interface Worktree {
  /**
   * Stable unique identifier for this worktree.
   * This ID is durable across restarts and session lifecycle changes.
   */
  readonly id: string;

  /**
   * Human-readable display title for the worktree.
   */
  readonly title: string;

  /**
   * Absolute path to the worktree directory.
   */
  readonly path: string;

  /**
   * Git branch name associated with this worktree.
   */
  readonly branch: string;

  /**
   * Current lifecycle status.
   */
  readonly status: WorktreeLifecycleStatus;

  /**
   * The canonical repository root this worktree belongs to.
   */
  readonly repoRoot: string;

  /**
   * Time the worktree was created.
   */
  readonly createdAt: number;

  /**
   * Time the worktree was last updated.
   */
  readonly updatedAt: number;

  /**
   * Time the worktree was archived (if applicable).
   */
  readonly archivedAt?: number;

  /**
   * Time the worktree was removed (if applicable).
   */
  readonly removedAt?: number;

  /**
   * Error message if worktree creation or operation failed.
   */
  readonly error?: string;

  /**
   * Whether this worktree is a Rudu-managed worktree.
   * Rudu only manages worktrees it created.
   */
  readonly isRuduManaged: boolean;
}

/**
 * Lightweight worktree shape for list views.
 */
export type WorktreeSummary = Omit<
  Worktree,
  | "error"
>;

/**
 * Returns true when the given status is terminal.
 */
export function isTerminalWorktreeStatus(
  status: WorktreeLifecycleStatus,
): status is TerminalWorktreeStatus {
  return status === "removed";
}

/**
 * Checks if a worktree is in an active state (visible in default navigation).
 */
export function isActiveWorktreeStatus(
  status: WorktreeLifecycleStatus,
): boolean {
  return status === "creating" || status === "active";
}

/**
 * Checks if a worktree is still visible in the default UI
 * (active, archived, or in cleanup states - but not removed).
 */
export function isVisibleWorktreeStatus(
  status: WorktreeLifecycleStatus,
): boolean {
  return status !== "removed";
}

/**
 * Returns a human-readable label for a worktree status.
 */
export function getWorktreeStatusLabel(
  status: WorktreeLifecycleStatus,
): string {
  switch (status) {
    case "creating":
      return "Creating...";
    case "active":
      return "Active";
    case "archived":
      return "Archived";
    case "archive_failed":
      return "Archive failed";
    case "cleanup_pending":
      return "Cleaning up...";
    case "cleanup_failed":
      return "Cleanup failed";
    case "removed":
      return "Removed";
    default:
      return String(status);
  }
}

/**
 * Represents a worktree-to-session association.
 * Used for rehydrating the worktree-session graph.
 */
export interface WorktreeSessionLink {
  readonly worktreeId: string;
  readonly sessionId: string;
}

/**
 * Represents the complete worktree-session graph for rehydration.
 */
export interface WorktreeSessionGraph {
  readonly worktrees: readonly Worktree[];
  readonly sessions: readonly WorktreeSessionLink[];
}
