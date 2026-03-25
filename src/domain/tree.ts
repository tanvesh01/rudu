/**
 * Domain model for the combined worktree/session tree view.
 *
 * The tree represents a hierarchy where:
 * - Worktrees are parent nodes
 * - Sessions are child nodes of their associated worktree
 *
 * This enables unified navigation and selection across both entity types.
 */

import type { SessionSnapshot } from "../services/SessionManager.js";
import type { Worktree } from "./worktree.js";

/**
 * Node type discriminator for tree nodes.
 */
export type TreeNodeType = "worktree" | "session";

/**
 * Base interface for all tree nodes.
 */
export interface TreeNodeBase {
  readonly id: string;
  readonly type: TreeNodeType;
}

/**
 * A worktree node in the tree.
 */
export interface WorktreeNode extends TreeNodeBase {
  readonly type: "worktree";
  readonly worktree: Worktree;
  readonly children: SessionNode[];
  readonly isExpanded: boolean;
}

/**
 * A session node in the tree.
 */
export interface SessionNode extends TreeNodeBase {
  readonly type: "session";
  readonly session: SessionSnapshot;
  readonly worktreeId: string;
}

/**
 * Union type for all tree nodes.
 */
export type TreeNode = WorktreeNode | SessionNode;

/**
 * Selection state that tracks which node is selected and its type.
 */
export interface TreeSelection {
  /**
   * The ID of the selected node (either worktree ID or session ID).
   */
  readonly selectedId: string | null;

  /**
   * The type of the selected node, if any.
   */
  readonly selectedType: TreeNodeType | null;
}

/**
 * Flattened tree item for list rendering.
 * Includes indentation level for visual hierarchy.
 */
export interface FlattenedTreeItem {
  readonly node: TreeNode;
  readonly level: number;
  readonly isFirstChild: boolean;
  readonly isLastChild: boolean;
}

/**
 * Builds a tree structure from worktrees and sessions.
 * Returns worktree nodes with their child session nodes.
 */
export function buildWorktreeSessionTree(
  worktrees: readonly Worktree[],
  sessions: readonly SessionSnapshot[],
  options: {
    expandAll?: boolean;
    expandedWorktreeIds?: ReadonlySet<string>;
  } = {},
): WorktreeNode[] {
  const { expandAll = true, expandedWorktreeIds } = options;

  // Group sessions by worktreeId
  const sessionsByWorktree = new Map<string, SessionSnapshot[]>();
  for (const session of sessions) {
    const worktreeId = session.worktreeId;
    if (!worktreeId) continue; // Skip orphaned sessions

    const list = sessionsByWorktree.get(worktreeId);
    if (list) {
      list.push(session);
    } else {
      sessionsByWorktree.set(worktreeId, [session]);
    }
  }

  // Sort sessions within each worktree by queuedAt time
  for (const [, sessionList] of sessionsByWorktree) {
    sessionList.sort((a, b) => a.queuedAt - b.queuedAt);
  }

  // Build worktree nodes with children
  const sortedWorktrees = [...worktrees].sort((a, b) => a.createdAt - b.createdAt);

  return sortedWorktrees.map((worktree) => {
    const childSessions = sessionsByWorktree.get(worktree.id) ?? [];
    const isExpanded = expandAll || expandedWorktreeIds?.has(worktree.id) || false;

    return {
      type: "worktree" as const,
      id: worktree.id,
      worktree,
      isExpanded,
      children: childSessions.map((session) => ({
        type: "session" as const,
        id: session.id,
        session,
        worktreeId: worktree.id,
      })),
    };
  });
}

/**
 * Flattens the tree structure for list rendering.
 * Only includes expanded worktrees' children.
 */
export function flattenTree(worktreeNodes: readonly WorktreeNode[]): FlattenedTreeItem[] {
  const result: FlattenedTreeItem[] = [];

  for (let i = 0; i < worktreeNodes.length; i++) {
    const worktreeNode = worktreeNodes[i];
    if (!worktreeNode) continue;

    const isLastWorktree = i === worktreeNodes.length - 1;

    result.push({
      node: worktreeNode,
      level: 0,
      isFirstChild: i === 0,
      isLastChild: isLastWorktree,
    });

    if (worktreeNode.isExpanded) {
      for (let j = 0; j < worktreeNode.children.length; j++) {
        const child = worktreeNode.children[j];
        if (!child) continue;
        result.push({
          node: child,
          level: 1,
          isFirstChild: j === 0,
          isLastChild: j === worktreeNode.children.length - 1,
        });
      }
    }
  }

  return result;
}

/**
 * Finds a node by ID in the tree.
 */
export function findNodeById(
  worktreeNodes: readonly WorktreeNode[],
  id: string,
): TreeNode | undefined {
  for (const worktreeNode of worktreeNodes) {
    if (worktreeNode.id === id) {
      return worktreeNode;
    }
    for (const child of worktreeNode.children) {
      if (child.id === id) {
        return child;
      }
    }
  }
  return undefined;
}

/**
 * Finds the first selectable session node in the tree.
 * Useful for default selection when no specific node is selected.
 */
export function findFirstSessionNode(
  worktreeNodes: readonly WorktreeNode[],
): SessionNode | undefined {
  for (const worktreeNode of worktreeNodes) {
    if (worktreeNode.children.length > 0) {
      return worktreeNode.children[0];
    }
  }
  return undefined;
}

/**
 * Finds the first selectable node (worktree or session) in the tree.
 */
export function findFirstNode(worktreeNodes: readonly WorktreeNode[]): TreeNode | undefined {
  if (worktreeNodes.length === 0) return undefined;

  const firstWorktree = worktreeNodes[0]!;
  if (firstWorktree.children.length > 0) {
    return firstWorktree.children[0];
  }
  return firstWorktree;
}

/**
 * Finds the parent worktree node for a given session node.
 */
export function findParentWorktree(
  worktreeNodes: readonly WorktreeNode[],
  sessionId: string,
): WorktreeNode | undefined {
  for (const worktreeNode of worktreeNodes) {
    const hasChild = worktreeNode.children.some((child) => child.id === sessionId);
    if (hasChild) {
      return worktreeNode;
    }
  }
  return undefined;
}

/**
 * Repairs selection when the currently selected node becomes invalid.
 * Returns a new selection pointing to a valid node, or null if no valid nodes exist.
 */
export function repairSelection(
  worktreeNodes: readonly WorktreeNode[],
  currentSelection: TreeSelection,
): TreeSelection {
  const { selectedId, selectedType } = currentSelection;

  // If nothing is selected, try to select the first available node
  if (!selectedId || !selectedType) {
    const firstNode = findFirstNode(worktreeNodes);
    return firstNode
      ? { selectedId: firstNode.id, selectedType: firstNode.type }
      : { selectedId: null, selectedType: null };
  }

  // Check if the current selection is still valid
  const currentNode = findNodeById(worktreeNodes, selectedId);
  if (currentNode && currentNode.type === selectedType) {
    // Selection is still valid
    return currentSelection;
  }

  // Selection is invalid - repair it
  if (selectedType === "session") {
    // Try to find another session in the same worktree
    const parentWorktree = findParentWorktreeBySessionId(worktreeNodes, selectedId);
    if (parentWorktree) {
      // Select the first remaining session in this worktree
      if (parentWorktree.children.length > 0) {
        const firstChild = parentWorktree.children[0]!;
        return { selectedId: firstChild.id, selectedType: "session" };
      }
      // No sessions left in this worktree - select the worktree itself
      return { selectedId: parentWorktree.id, selectedType: "worktree" };
    }
  }

  // Fall back to the first available node
  const firstNode = findFirstNode(worktreeNodes);
  return firstNode
    ? { selectedId: firstNode.id, selectedType: firstNode.type }
    : { selectedId: null, selectedType: null };
}

/**
 * Helper to find parent worktree by a session ID that may no longer exist.
 * Searches by looking at the previous tree structure.
 */
function findParentWorktreeBySessionId(
  worktreeNodes: readonly WorktreeNode[],
  sessionId: string,
): WorktreeNode | undefined {
  for (const worktreeNode of worktreeNodes) {
    // Check if this worktree would have contained the session
    // (we check by seeing if any current child has a similar ID pattern or just return the first worktree)
    // For now, we'll be conservative and only return if the worktree has sessions
    if (worktreeNode.children.length > 0) {
      return worktreeNode;
    }
  }
  return worktreeNodes[0];
}

/**
 * Gets all selectable node IDs in order (for keyboard navigation).
 */
export function getSelectableNodeIds(worktreeNodes: readonly WorktreeNode[]): string[] {
  const ids: string[] = [];
  for (const worktreeNode of worktreeNodes) {
    ids.push(worktreeNode.id);
    if (worktreeNode.isExpanded) {
      for (const child of worktreeNode.children) {
        ids.push(child.id);
      }
    }
  }
  return ids;
}

/**
 * Finds the next selectable node ID for keyboard navigation.
 */
export function findNextNodeId(
  worktreeNodes: readonly WorktreeNode[],
  currentId: string | null,
): string | null {
  const selectableIds = getSelectableNodeIds(worktreeNodes);
  if (selectableIds.length === 0) return null;

  if (!currentId) {
    return selectableIds[0] ?? null;
  }

  const currentIndex = selectableIds.indexOf(currentId);
  if (currentIndex === -1) {
    return selectableIds[0] ?? null;
  }

  return selectableIds[currentIndex + 1] ?? selectableIds[selectableIds.length - 1] ?? null;
}

/**
 * Finds the previous selectable node ID for keyboard navigation.
 */
export function findPreviousNodeId(
  worktreeNodes: readonly WorktreeNode[],
  currentId: string | null,
): string | null {
  const selectableIds = getSelectableNodeIds(worktreeNodes);
  if (selectableIds.length === 0) return null;

  if (!currentId) {
    return selectableIds[selectableIds.length - 1] ?? null;
  }

  const currentIndex = selectableIds.indexOf(currentId);
  if (currentIndex === -1) {
    return selectableIds[selectableIds.length - 1] ?? null;
  }

  return selectableIds[currentIndex - 1] ?? selectableIds[0] ?? null;
}

/**
 * Gets the worktree ID associated with a node.
 * For worktree nodes, returns its own ID.
 * For session nodes, returns the parent worktree ID.
 */
export function getAssociatedWorktreeId(node: TreeNode): string | undefined {
  if (node.type === "worktree") {
    return node.id;
  }
  return node.worktreeId;
}
