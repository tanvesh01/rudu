import { describe, it, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { WorktreeList, getSessionForWorktree, repairWorktreeSelection } from "./WorktreeList.js";
import type { Worktree } from "../domain/worktree.js";
import type { SessionSnapshot } from "../services/SessionManager.js";

describe("WorktreeList", () => {
  const mockWorktrees: Worktree[] = [
    {
      id: "wt-1",
      repoRoot: "/repo",
      title: "Feature One",
      branch: "rudu/feature-one",
      path: "/repo/../rudu-feature-one",
      createdAt: 1000,
      updatedAt: 1000,
      status: "active",
      isRuduManaged: true,
    },
    {
      id: "wt-2",
      repoRoot: "/repo",
      title: "Feature Two",
      branch: "rudu/feature-two",
      path: "/repo/../rudu-feature-two",
      createdAt: 2000,
      updatedAt: 2000,
      status: "active",
      isRuduManaged: true,
    },
  ];

  const mockSessions: SessionSnapshot[] = [
    {
      id: "session-1",
      title: "Session for Feature One",
      command: ["pi-sdk-session"],
      status: "running",
      worktreeId: "wt-1",
      queuedAt: 1000,
      startedAt: 1500,
      canSendFollowUp: true,
      logSummary: { retainedLines: 0, retainedBytes: 0, droppedLines: 0 },
      transcriptSummary: { retainedMessages: 0, retainedBytes: 0, droppedMessages: 0 },
    },
    {
      id: "session-2",
      title: "Session for Feature Two",
      command: ["pi-sdk-session"],
      status: "succeeded",
      worktreeId: "wt-2",
      queuedAt: 2000,
      startedAt: 2500,
      finishedAt: 3000,
      exitCode: 0,
      canSendFollowUp: false,
      logSummary: { retainedLines: 100, retainedBytes: 5000, droppedLines: 0 },
      transcriptSummary: { retainedMessages: 0, retainedBytes: 0, droppedMessages: 0 },
    },
  ];

  describe("rendering", () => {
    it("renders worktree list with titles", async () => {
      const onSelect = () => {};
      const testSetup = await testRender(
        <WorktreeList
          worktrees={mockWorktrees}
          sessions={mockSessions}
          selectedWorktreeId="wt-1"
          focused={true}
          onSelect={onSelect}
        />,
        { width: 80, height: 10 }
      );
      await testSetup.renderOnce();
      const frame = testSetup.captureCharFrame();
      expect(frame).toContain("Feature One");
      expect(frame).toContain("Feature Two");
      testSetup.renderer.destroy();
    });

    it("shows empty state when no worktrees exist", async () => {
      const onSelect = () => {};
      const testSetup = await testRender(
        <WorktreeList
          worktrees={[]}
          sessions={[]}
          selectedWorktreeId={null}
          focused={true}
          onSelect={onSelect}
        />,
        { width: 80, height: 10 }
      );
      await testSetup.renderOnce();
      const frame = testSetup.captureCharFrame();
      expect(frame).toContain("No worktrees yet");
      expect(frame).toContain("Ctrl+N");
      testSetup.renderer.destroy();
    });

    it("shows session status in description", async () => {
      const onSelect = () => {};
      const testSetup = await testRender(
        <WorktreeList
          worktrees={mockWorktrees}
          sessions={mockSessions}
          selectedWorktreeId="wt-1"
          focused={true}
          onSelect={onSelect}
        />,
        { width: 80, height: 10 }
      );
      await testSetup.renderOnce();
      const frame = testSetup.captureCharFrame();
      // Should show running status for first worktree
      expect(frame).toContain("running");
      // Should show succeeded status for second worktree
      expect(frame).toContain("succeeded");
      testSetup.renderer.destroy();
    });
  });
});

describe("getSessionForWorktree", () => {
  const worktrees: Worktree[] = [
    {
      id: "wt-1",
      repoRoot: "/repo",
      title: "Feature",
      branch: "rudu/feature",
      path: "/repo/../rudu-feature",
      createdAt: 1000,
      updatedAt: 1000,
      status: "active",
      isRuduManaged: true,
    },
  ];

  const sessions: SessionSnapshot[] = [
    {
      id: "session-1",
      title: "First Session",
      command: ["pi-sdk-session"],
      status: "succeeded",
      worktreeId: "wt-1",
      queuedAt: 1000,
      startedAt: 1000,
      finishedAt: 2000,
      exitCode: 0,
      canSendFollowUp: false,
      logSummary: { retainedLines: 0, retainedBytes: 0, droppedLines: 0 },
      transcriptSummary: { retainedMessages: 0, retainedBytes: 0, droppedMessages: 0 },
    },
    {
      id: "session-2",
      title: "Second Session",
      command: ["pi-sdk-session"],
      status: "running",
      worktreeId: "wt-1",
      queuedAt: 3000,
      startedAt: 3500,
      canSendFollowUp: true,
      logSummary: { retainedLines: 0, retainedBytes: 0, droppedLines: 0 },
      transcriptSummary: { retainedMessages: 0, retainedBytes: 0, droppedMessages: 0 },
    },
  ];

  it("returns the most recent session for the selected worktree", () => {
    const result = getSessionForWorktree(worktrees, sessions, "wt-1");
    expect(result).toBeDefined();
    expect(result?.id).toBe("session-2");
    expect(result?.status).toBe("running");
  });

  it("returns null when no worktree is selected", () => {
    const result = getSessionForWorktree(worktrees, sessions, null);
    expect(result).toBeNull();
  });

  it("returns null when worktree has no sessions", () => {
    const result = getSessionForWorktree(worktrees, [], "wt-1");
    expect(result).toBeNull();
  });

  it("returns null when worktree does not exist", () => {
    const result = getSessionForWorktree(worktrees, sessions, "non-existent");
    expect(result).toBeNull();
  });
});

describe("repairWorktreeSelection", () => {
  const worktrees: Worktree[] = [
    {
      id: "wt-1",
      repoRoot: "/repo",
      title: "Feature One",
      branch: "rudu/feature-one",
      path: "/repo/../rudu-feature-one",
      createdAt: 1000,
      updatedAt: 1000,
      status: "active",
      isRuduManaged: true,
    },
    {
      id: "wt-2",
      repoRoot: "/repo",
      title: "Feature Two",
      branch: "rudu/feature-two",
      path: "/repo/../rudu-feature-two",
      createdAt: 2000,
      updatedAt: 2000,
      status: "active",
      isRuduManaged: true,
    },
  ];

  it("returns first worktree ID when nothing is selected", () => {
    const result = repairWorktreeSelection(worktrees, null);
    expect(result).toBe("wt-1");
  });

  it("maintains current selection when valid", () => {
    const result = repairWorktreeSelection(worktrees, "wt-2");
    expect(result).toBe("wt-2");
  });

  it("repairs to first worktree when current selection is invalid", () => {
    const result = repairWorktreeSelection(worktrees, "non-existent");
    expect(result).toBe("wt-1");
  });

  it("returns null when no worktrees exist", () => {
    const result = repairWorktreeSelection([], null);
    expect(result).toBeNull();
  });

  it("returns null when current selection is invalid and no worktrees exist", () => {
    const result = repairWorktreeSelection([], "non-existent");
    expect(result).toBeNull();
  });
});
