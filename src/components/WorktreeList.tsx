import type { Worktree } from "../domain/worktree.js";
import type { SessionSnapshot } from "../services/SessionManager.js";
import { theme } from "../app/theme.js";

interface WorktreeListProps {
  worktrees: readonly Worktree[];
  sessions: readonly SessionSnapshot[];
  selectedWorktreeId: string | null;
  focused: boolean;
  onSelect: (worktreeId: string) => void;
}

const statusColors: Record<string, string> = {
  queued: theme.status.queued,
  starting: theme.status.starting,
  running: theme.status.running,
  cancelling: theme.status.cancelling,
  succeeded: theme.status.succeeded,
  failed: theme.status.failed,
  cancelled: theme.status.cancelled,
};

/**
 * Get the display session for a worktree.
 * In single-session mode, each worktree has exactly one session.
 * Returns the most recent session for the worktree.
 */
function getWorktreeSession(
  worktreeId: string,
  sessions: readonly SessionSnapshot[],
): SessionSnapshot | undefined {
  return sessions
    .filter((s) => s.worktreeId === worktreeId)
    .sort((a, b) => b.queuedAt - a.queuedAt)[0];
}

function getWorktreeDisplayInfo(worktree: Worktree, session?: SessionSnapshot) {
  if (!session) {
    return {
      name: worktree.title,
      description: worktree.branch,
      statusColor: theme.fgDark,
    };
  }

  return {
    name: worktree.title,
    description: worktree.branch,
    statusColor: statusColors[session.status] ?? theme.fgNormal,
  };
}

/**
 * Flat worktree list component for single-session mode.
 *
 * In this simplified navigation model:
 * - The left navigation is a flat list of worktrees (no parent/child tree)
 * - Selecting a worktree implicitly targets its single associated session
 * - No tree node types or child session rows are exposed
 */
export function WorktreeList({
  worktrees,
  sessions,
  selectedWorktreeId,
  focused,
  onSelect,
}: WorktreeListProps) {
  // Sort worktrees by creation time
  const sortedWorktrees = [...worktrees].sort(
    (a, b) => a.createdAt - b.createdAt,
  );

  // Find the selected index
  const selectedIndex = sortedWorktrees.findIndex(
    (wt) => wt.id === selectedWorktreeId,
  );

  // If no worktrees, show empty state
  if (sortedWorktrees.length === 0) {
    return (
      <box>
        <text
          content="No worktrees yet. Press Ctrl+N to create one."
          fg={theme.fgDark}
        />
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1} height="100%">
      <select
        options={sortedWorktrees.map((worktree) => {
          const session = getWorktreeSession(worktree.id, sessions);
          const info = getWorktreeDisplayInfo(worktree, session);
          return {
            name: info.name,
            description: info.description,
          };
        })}
        selectedIndex={Math.max(0, selectedIndex)}
        focused={focused}
        onChange={(index: number) => {
          const worktree = sortedWorktrees[index];
          if (worktree) {
            onSelect(worktree.id);
          }
        }}
        height="100%"
        showScrollIndicator
        selectedBackgroundColor="#ffffff"
        selectedTextColor="#000000"
        selectedDescriptionColor="#000000"
      />
    </box>
  );
}

/**
 * Get the session associated with the selected worktree.
 * Returns null if no worktree is selected or the worktree has no session.
 */
export function getSessionForWorktree(
  worktrees: readonly Worktree[],
  sessions: readonly SessionSnapshot[],
  selectedWorktreeId: string | null,
): SessionSnapshot | null {
  if (!selectedWorktreeId) {
    return null;
  }

  const worktree = worktrees.find((wt) => wt.id === selectedWorktreeId);
  if (!worktree) {
    return null;
  }

  return (
    sessions
      .filter((s) => s.worktreeId === selectedWorktreeId)
      .sort((a, b) => b.queuedAt - a.queuedAt)[0] ?? null
  );
}

/**
 * Get the worktree for a given session ID.
 * Used for reverse lookups when needed.
 */
export function getWorktreeForSession(
  worktrees: readonly Worktree[],
  sessionId: string,
): Worktree | undefined {
  return worktrees.find((wt) => wt.id === sessionId);
}

/**
 * Repair selection when the currently selected worktree becomes invalid.
 * Returns a new selection pointing to a valid worktree, or null if no valid worktrees exist.
 */
export function repairWorktreeSelection(
  worktrees: readonly Worktree[],
  currentSelectedId: string | null,
): string | null {
  // If nothing is selected, try to select the first worktree
  if (!currentSelectedId) {
    const firstWorktree = worktrees[0];
    return firstWorktree?.id ?? null;
  }

  // Check if the current selection is still valid
  const currentWorktree = worktrees.find((wt) => wt.id === currentSelectedId);
  if (currentWorktree) {
    // Selection is still valid
    return currentSelectedId;
  }

  // Selection is invalid - repair it by selecting the first available worktree
  const firstWorktree = worktrees[0];
  return firstWorktree?.id ?? null;
}
