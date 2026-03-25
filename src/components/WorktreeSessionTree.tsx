import type { Worktree } from "../domain/worktree.js";
import type { SessionSnapshot } from "../services/SessionManager.js";
import {
  buildWorktreeSessionTree,
  flattenTree,
  findNodeById,
  type TreeNode,
  type TreeNodeType,
} from "../domain/tree.js";
import { formatDuration } from "../domain/session.js";
import { theme } from "../app/theme.js";

interface WorktreeSessionTreeProps {
  worktrees: readonly Worktree[];
  sessions: readonly SessionSnapshot[];
  selectedId: string | null;
  selectedType: TreeNodeType | null;
  focused: boolean;
  onSelect: (id: string, type: TreeNodeType) => void;
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

function getSessionDisplayInfo(session: SessionSnapshot) {
  const now = Date.now();
  const duration = session.startedAt
    ? formatDuration((session.finishedAt ?? now) - session.startedAt)
    : formatDuration(now - session.queuedAt);

  return {
    name: session.title,
    description: `${session.status} | ${duration}`,
  };
}

export function WorktreeSessionTree({
  worktrees,
  sessions,
  selectedId,
  selectedType,
  focused,
  onSelect,
}: WorktreeSessionTreeProps) {
  const treeNodes = buildWorktreeSessionTree(worktrees, sessions, {
    expandAll: true,
  });
  const flattenedItems = flattenTree(treeNodes);

  // Find the selected index
  const selectedIndex = flattenedItems.findIndex((item) => {
    if (!selectedId || !selectedType) return false;
    return item.node.id === selectedId && item.node.type === selectedType;
  });

  // If no valid selection, show empty state
  if (flattenedItems.length === 0) {
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
    <box flexDirection="column" flexGrow={1}>
      <select
        options={flattenedItems.map((item) => {
          if (item.node.type === "worktree") {
            return {
              name: `${item.node.isExpanded ? "▼" : "▶"} ${item.node.worktree.title}`,
              description: item.node.worktree.branch,
            };
          } else {
            const info = getSessionDisplayInfo(item.node.session);
            return {
              name: `  ◆ ${info.name}`,
              description: info.description,
            };
          }
        })}
        selectedIndex={Math.max(0, selectedIndex)}
        focused={focused}
        onChange={(index: number) => {
          const item = flattenedItems[index];
          if (item) {
            onSelect(item.node.id, item.node.type);
          }
        }}
        height={Math.max(5, flattenedItems.length + 2)}
        selectedBackgroundColor="#ffffff"
        selectedTextColor="#000000"
      />
    </box>
  );
}

/**
 * Get the selected session from tree state.
 * Returns null if a worktree is selected or nothing is selected.
 */
export function getSelectedSession(
  worktrees: readonly Worktree[],
  sessions: readonly SessionSnapshot[],
  selectedId: string | null,
  selectedType: TreeNodeType | null,
): SessionSnapshot | null {
  if (selectedType !== "session" || !selectedId) {
    return null;
  }
  return sessions.find((s) => s.id === selectedId) ?? null;
}

/**
 * Get the selected node details.
 */
export function getSelectedNode(
  worktrees: readonly Worktree[],
  sessions: readonly SessionSnapshot[],
  selectedId: string | null,
  selectedType: TreeNodeType | null,
): TreeNode | null {
  if (!selectedId || !selectedType) {
    return null;
  }

  const treeNodes = buildWorktreeSessionTree(worktrees, sessions);
  return findNodeById(treeNodes, selectedId) ?? null;
}
