import { describe, it, expect } from "bun:test";
import type { Worktree } from "./worktree.js";
import type { SessionSnapshot } from "../services/SessionManager.js";
import {
  buildWorktreeSessionTree,
  flattenTree,
  findNodeById,
  findFirstSessionNode,
  findFirstNode,
  repairSelection,
  getSelectableNodeIds,
  findNextNodeId,
  findPreviousNodeId,
  getAssociatedWorktreeId,
  type WorktreeNode,
  type SessionNode,
} from "./tree.js";

// Test fixtures
const createWorktree = (id: string, title: string, status: Worktree["status"] = "active"): Worktree => ({
  id,
  title,
  path: `/tmp/${title}`,
  branch: `feature/${title.toLowerCase().replace(/\s+/g, "-")}`,
  status,
  repoRoot: "/tmp/repo",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isRuduManaged: true,
});

const createSession = (
  id: string,
  title: string,
  worktreeId: string,
  status: SessionSnapshot["status"] = "queued",
): SessionSnapshot => ({
  id,
  title,
  command: ["test"],
  status,
  queuedAt: Date.now(),
  logSummary: { retainedLines: 0, retainedBytes: 0, droppedLines: 0 },
  transcriptSummary: { retainedMessages: 0, retainedBytes: 0, droppedMessages: 0 },
  canSendFollowUp: false,
  worktreeId,
});

describe("buildWorktreeSessionTree", () => {
  it("builds empty tree when no worktrees exist", () => {
    const tree = buildWorktreeSessionTree([], []);
    expect(tree).toEqual([]);
  });

  it("builds tree with worktrees but no sessions", () => {
    const worktrees = [createWorktree("wt-1", "Feature One")];
    const tree = buildWorktreeSessionTree(worktrees, []);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.id).toBe("wt-1");
    expect(tree[0]?.children).toEqual([]);
  });

  it("groups sessions under their parent worktree", () => {
    const worktrees = [
      createWorktree("wt-1", "Feature One"),
      createWorktree("wt-2", "Feature Two"),
    ];
    const sessions = [
      createSession("sess-1", "Session 1", "wt-1"),
      createSession("sess-2", "Session 2", "wt-1"),
      createSession("sess-3", "Session 3", "wt-2"),
    ];

    const tree = buildWorktreeSessionTree(worktrees, sessions);

    expect(tree).toHaveLength(2);
    expect(tree[0]?.children).toHaveLength(2);
    expect(tree[0]?.children[0]?.id).toBe("sess-1");
    expect(tree[0]?.children[1]?.id).toBe("sess-2");
    expect(tree[1]?.children).toHaveLength(1);
    expect(tree[1]?.children[0]?.id).toBe("sess-3");
  });

  it("ignores orphaned sessions without matching worktree", () => {
    const worktrees = [createWorktree("wt-1", "Feature One")];
    const sessions = [
      createSession("sess-1", "Valid Session", "wt-1"),
      createSession("sess-2", "Orphan Session", "wt-missing"),
    ];

    const tree = buildWorktreeSessionTree(worktrees, sessions);

    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.id).toBe("sess-1");
  });

  it("sorts worktrees by createdAt", () => {
    const worktrees = [
      { ...createWorktree("wt-2", "Second"), createdAt: 2000 },
      { ...createWorktree("wt-1", "First"), createdAt: 1000 },
      { ...createWorktree("wt-3", "Third"), createdAt: 3000 },
    ];

    const tree = buildWorktreeSessionTree(worktrees, []);

    expect(tree[0]?.id).toBe("wt-1");
    expect(tree[1]?.id).toBe("wt-2");
    expect(tree[2]?.id).toBe("wt-3");
  });

  it("sorts sessions by queuedAt within each worktree", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const sessions = [
      { ...createSession("sess-2", "Second", "wt-1"), queuedAt: 2000 },
      { ...createSession("sess-1", "First", "wt-1"), queuedAt: 1000 },
      { ...createSession("sess-3", "Third", "wt-1"), queuedAt: 3000 },
    ];

    const tree = buildWorktreeSessionTree(worktrees, sessions);

    expect(tree[0]?.children[0]?.id).toBe("sess-1");
    expect(tree[0]?.children[1]?.id).toBe("sess-2");
    expect(tree[0]?.children[2]?.id).toBe("sess-3");
  });

  it("expands all worktrees by default", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const sessions = [createSession("sess-1", "Session", "wt-1")];

    const tree = buildWorktreeSessionTree(worktrees, sessions);

    expect(tree[0]?.isExpanded).toBe(true);
  });

  it("respects expandedWorktreeIds option", () => {
    const worktrees = [
      createWorktree("wt-1", "Feature One"),
      createWorktree("wt-2", "Feature Two"),
    ];

    const tree = buildWorktreeSessionTree(worktrees, [], {
      expandAll: false,
      expandedWorktreeIds: new Set(["wt-1"]),
    });

    expect(tree[0]?.isExpanded).toBe(true);
    expect(tree[1]?.isExpanded).toBe(false);
  });
});

describe("flattenTree", () => {
  it("returns empty array for empty tree", () => {
    const flat = flattenTree([]);
    expect(flat).toEqual([]);
  });

  it("flattens worktrees at level 0", () => {
    const tree = buildWorktreeSessionTree([createWorktree("wt-1", "Feature")], []);
    const flat = flattenTree(tree);

    expect(flat).toHaveLength(1);
    expect(flat[0]?.node.type).toBe("worktree");
    expect(flat[0]?.level).toBe(0);
  });

  it("includes expanded worktree children at level 1", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const sessions = [createSession("sess-1", "Session", "wt-1")];
    const tree = buildWorktreeSessionTree(worktrees, sessions);
    const flat = flattenTree(tree);

    expect(flat).toHaveLength(2);
    expect(flat[0]?.node.type).toBe("worktree");
    expect(flat[0]?.level).toBe(0);
    expect(flat[1]?.node.type).toBe("session");
    expect(flat[1]?.level).toBe(1);
  });

  it("excludes children of collapsed worktrees", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const sessions = [createSession("sess-1", "Session", "wt-1")];
    const tree = buildWorktreeSessionTree(worktrees, sessions, {
      expandAll: false,
      expandedWorktreeIds: new Set(),
    });
    const flat = flattenTree(tree);

    expect(flat).toHaveLength(1);
    expect(flat[0]?.node.type).toBe("worktree");
  });

  it("sets isFirstChild and isLastChild correctly", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const sessions = [
      createSession("sess-1", "First", "wt-1"),
      createSession("sess-2", "Last", "wt-1"),
    ];
    const tree = buildWorktreeSessionTree(worktrees, sessions);
    const flat = flattenTree(tree);

    expect(flat[0]?.isFirstChild).toBe(true);
    expect(flat[0]?.isLastChild).toBe(true);
    expect(flat[1]?.isFirstChild).toBe(true);
    expect(flat[1]?.isLastChild).toBe(false);
    expect(flat[2]?.isFirstChild).toBe(false);
    expect(flat[2]?.isLastChild).toBe(true);
  });
});

describe("findNodeById", () => {
  const worktrees = [createWorktree("wt-1", "Feature")];
  const sessions = [createSession("sess-1", "Session", "wt-1")];
  const tree = buildWorktreeSessionTree(worktrees, sessions);

  it("finds worktree node by id", () => {
    const node = findNodeById(tree, "wt-1");
    expect(node?.type).toBe("worktree");
    expect(node?.id).toBe("wt-1");
  });

  it("finds session node by id", () => {
    const node = findNodeById(tree, "sess-1");
    expect(node?.type).toBe("session");
    expect(node?.id).toBe("sess-1");
  });

  it("returns undefined for unknown id", () => {
    const node = findNodeById(tree, "unknown");
    expect(node).toBeUndefined();
  });
});

describe("findFirstSessionNode", () => {
  it("returns first session from first worktree with sessions", () => {
    const worktrees = [
      createWorktree("wt-1", "Empty"),
      createWorktree("wt-2", "Has Sessions"),
    ];
    const sessions = [createSession("sess-1", "First", "wt-2")];
    const tree = buildWorktreeSessionTree(worktrees, sessions);

    const first = findFirstSessionNode(tree);
    expect(first?.id).toBe("sess-1");
  });

  it("returns undefined when no sessions exist", () => {
    const tree = buildWorktreeSessionTree([createWorktree("wt-1", "Empty")], []);
    const first = findFirstSessionNode(tree);
    expect(first).toBeUndefined();
  });

  it("returns undefined for empty tree", () => {
    const first = findFirstSessionNode([]);
    expect(first).toBeUndefined();
  });
});

describe("findFirstNode", () => {
  it("returns first session when sessions exist", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const sessions = [createSession("sess-1", "Session", "wt-1")];
    const tree = buildWorktreeSessionTree(worktrees, sessions);

    const first = findFirstNode(tree);
    expect(first?.type).toBe("session");
    expect(first?.id).toBe("sess-1");
  });

  it("returns first worktree when no sessions exist", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const tree = buildWorktreeSessionTree(worktrees, []);

    const first = findFirstNode(tree);
    expect(first?.type).toBe("worktree");
    expect(first?.id).toBe("wt-1");
  });

  it("returns undefined for empty tree", () => {
    const first = findFirstNode([]);
    expect(first).toBeUndefined();
  });
});

describe("repairSelection", () => {
  const worktrees = [createWorktree("wt-1", "Feature")];
  const sessions = [createSession("sess-1", "Session", "wt-1")];

  it("keeps valid selection unchanged", () => {
    const tree = buildWorktreeSessionTree(worktrees, sessions);
    const selection = { selectedId: "sess-1", selectedType: "session" as const };

    const repaired = repairSelection(tree, selection);
    expect(repaired.selectedId).toBe("sess-1");
    expect(repaired.selectedType).toBe("session");
  });

  it("selects first node when selection is null", () => {
    const tree = buildWorktreeSessionTree(worktrees, sessions);
    const selection = { selectedId: null, selectedType: null };

    const repaired = repairSelection(tree, selection);
    expect(repaired.selectedId).toBe("sess-1");
    expect(repaired.selectedType).toBe("session");
  });

  it("repairs to first session when selected session is removed", () => {
    const tree = buildWorktreeSessionTree(worktrees, sessions);
    // Try to select a session that doesn't exist
    const selection = { selectedId: "sess-missing", selectedType: "session" as const };

    const repaired = repairSelection(tree, selection);
    // Should fall back to first available node
    expect(repaired.selectedId).toBeTruthy();
    expect(repaired.selectedType).toBeTruthy();
  });

  it("repairs to worktree when session removed and no other sessions", () => {
    const tree = buildWorktreeSessionTree(worktrees, []);
    const selection = { selectedId: "sess-missing", selectedType: "session" as const };

    const repaired = repairSelection(tree, selection);
    expect(repaired.selectedId).toBe("wt-1");
    expect(repaired.selectedType).toBe("worktree");
  });

  it("returns null selection for empty tree", () => {
    const selection = { selectedId: "anything", selectedType: "session" as const };
    const repaired = repairSelection([], selection);
    expect(repaired.selectedId).toBeNull();
    expect(repaired.selectedType).toBeNull();
  });
});

describe("getSelectableNodeIds", () => {
  it("returns all worktree and session ids when expanded", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const sessions = [
      createSession("sess-1", "First", "wt-1"),
      createSession("sess-2", "Second", "wt-1"),
    ];
    const tree = buildWorktreeSessionTree(worktrees, sessions);
    const ids = getSelectableNodeIds(tree);

    expect(ids).toEqual(["wt-1", "sess-1", "sess-2"]);
  });

  it("returns only worktree ids when collapsed", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const sessions = [createSession("sess-1", "Session", "wt-1")];
    const tree = buildWorktreeSessionTree(worktrees, sessions, {
      expandAll: false,
      expandedWorktreeIds: new Set(),
    });
    const ids = getSelectableNodeIds(tree);

    expect(ids).toEqual(["wt-1"]);
  });

  it("returns empty array for empty tree", () => {
    const ids = getSelectableNodeIds([]);
    expect(ids).toEqual([]);
  });
});

describe("findNextNodeId", () => {
  it("returns first id when current is null", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const tree = buildWorktreeSessionTree(worktrees, []);
    const next = findNextNodeId(tree, null);
    expect(next).toBe("wt-1");
  });

  it("returns next id in sequence", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const sessions = [createSession("sess-1", "Session", "wt-1")];
    const tree = buildWorktreeSessionTree(worktrees, sessions);

    const next = findNextNodeId(tree, "wt-1");
    expect(next).toBe("sess-1");
  });

  it("returns last id when at end of list", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const sessions = [createSession("sess-1", "Session", "wt-1")];
    const tree = buildWorktreeSessionTree(worktrees, sessions);

    const next = findNextNodeId(tree, "sess-1");
    expect(next).toBe("sess-1");
  });

  it("handles unknown current id gracefully", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const tree = buildWorktreeSessionTree(worktrees, []);
    const next = findNextNodeId(tree, "unknown");
    expect(next).toBe("wt-1");
  });
});

describe("findPreviousNodeId", () => {
  it("returns last id when current is null", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const tree = buildWorktreeSessionTree(worktrees, []);
    const prev = findPreviousNodeId(tree, null);
    expect(prev).toBe("wt-1");
  });

  it("returns previous id in sequence", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const sessions = [createSession("sess-1", "Session", "wt-1")];
    const tree = buildWorktreeSessionTree(worktrees, sessions);

    const prev = findPreviousNodeId(tree, "sess-1");
    expect(prev).toBe("wt-1");
  });

  it("returns first id when at start of list", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const sessions = [createSession("sess-1", "Session", "wt-1")];
    const tree = buildWorktreeSessionTree(worktrees, sessions);

    const prev = findPreviousNodeId(tree, "wt-1");
    expect(prev).toBe("wt-1");
  });

  it("handles unknown current id gracefully", () => {
    const worktrees = [createWorktree("wt-1", "Feature")];
    const tree = buildWorktreeSessionTree(worktrees, []);
    const prev = findPreviousNodeId(tree, "unknown");
    expect(prev).toBe("wt-1");
  });
});

describe("getAssociatedWorktreeId", () => {
  it("returns worktree id for worktree node", () => {
    const worktree = createWorktree("wt-1", "Feature");
    const node: WorktreeNode = {
      type: "worktree",
      id: "wt-1",
      worktree,
      children: [],
      isExpanded: true,
    };

    expect(getAssociatedWorktreeId(node)).toBe("wt-1");
  });

  it("returns parent worktree id for session node", () => {
    const node: SessionNode = {
      type: "session",
      id: "sess-1",
      session: createSession("sess-1", "Test", "wt-1"),
      worktreeId: "wt-1",
    };

    expect(getAssociatedWorktreeId(node)).toBe("wt-1");
  });
});
