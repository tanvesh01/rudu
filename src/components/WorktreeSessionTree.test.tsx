import { test, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { WorktreeSessionTree, getSelectedSession, getSelectedNode } from "./WorktreeSessionTree.js";
import type { Worktree } from "../domain/worktree.js";
import type { SessionSnapshot } from "../services/SessionManager.js";

let testSetup: Awaited<ReturnType<typeof testRender>>;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
  }
});

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

test("WorktreeSessionTree renders empty state when no worktrees exist", async () => {
  testSetup = await testRender(
    <WorktreeSessionTree
      worktrees={[]}
      sessions={[]}
      selectedId={null}
      selectedType={null}
      focused={true}
      onSelect={() => {}}
    />,
    { width: 80, height: 10 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();

  expect(frame).toContain("No worktrees yet");
  expect(frame).toContain("Ctrl+N");
});

test("WorktreeSessionTree renders worktree nodes", async () => {
  const worktrees = [createWorktree("wt-1", "Feature One")];

  testSetup = await testRender(
    <WorktreeSessionTree
      worktrees={worktrees}
      sessions={[]}
      selectedId={null}
      selectedType={null}
      focused={true}
      onSelect={() => {}}
    />,
    { width: 80, height: 10 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();

  expect(frame).toContain("Feature One");
  expect(frame).toContain("▼"); // Expanded indicator
});

test("WorktreeSessionTree renders session nodes under worktrees", async () => {
  const worktrees = [createWorktree("wt-1", "Feature One")];
  const sessions = [createSession("sess-1", "Test Session", "wt-1", "running")];

  testSetup = await testRender(
    <WorktreeSessionTree
      worktrees={worktrees}
      sessions={sessions}
      selectedId={null}
      selectedType={null}
      focused={true}
      onSelect={() => {}}
    />,
    { width: 80, height: 10 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();

  expect(frame).toContain("Feature One");
  expect(frame).toContain("Test Session");
});

test("WorktreeSessionTree shows session status in description", async () => {
  const worktrees = [createWorktree("wt-1", "Feature")];
  const sessions = [createSession("sess-1", "Test", "wt-1", "running")];

  testSetup = await testRender(
    <WorktreeSessionTree
      worktrees={worktrees}
      sessions={sessions}
      selectedId={null}
      selectedType={null}
      focused={true}
      onSelect={() => {}}
    />,
    { width: 80, height: 10 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();

  expect(frame).toContain("running");
});

test("getSelectedSession returns session when session node is selected", () => {
  const worktrees = [createWorktree("wt-1", "Feature")];
  const sessions = [createSession("sess-1", "Test Session", "wt-1")];
  const session = getSelectedSession(worktrees, sessions, "sess-1", "session");
  expect(session?.id).toBe("sess-1");
  expect(session?.title).toBe("Test Session");
});

test("getSelectedSession returns null when worktree node is selected", () => {
  const worktrees = [createWorktree("wt-1", "Feature")];
  const sessions = [createSession("sess-1", "Test Session", "wt-1")];
  const session = getSelectedSession(worktrees, sessions, "wt-1", "worktree");
  expect(session).toBeNull();
});

test("getSelectedSession returns null when nothing is selected", () => {
  const worktrees = [createWorktree("wt-1", "Feature")];
  const sessions = [createSession("sess-1", "Test Session", "wt-1")];
  const session = getSelectedSession(worktrees, sessions, null, null);
  expect(session).toBeNull();
});

test("getSelectedSession returns null for unknown session id", () => {
  const worktrees = [createWorktree("wt-1", "Feature")];
  const sessions = [createSession("sess-1", "Test Session", "wt-1")];
  const session = getSelectedSession(worktrees, sessions, "unknown", "session");
  expect(session).toBeNull();
});

test("getSelectedNode returns worktree node when worktree is selected", () => {
  const worktrees = [createWorktree("wt-1", "Feature")];
  const sessions = [createSession("sess-1", "Test Session", "wt-1")];
  const node = getSelectedNode(worktrees, sessions, "wt-1", "worktree");
  expect(node?.type).toBe("worktree");
  expect(node?.id).toBe("wt-1");
});

test("getSelectedNode returns session node when session is selected", () => {
  const worktrees = [createWorktree("wt-1", "Feature")];
  const sessions = [createSession("sess-1", "Test Session", "wt-1")];
  const node = getSelectedNode(worktrees, sessions, "sess-1", "session");
  expect(node?.type).toBe("session");
  expect(node?.id).toBe("sess-1");
});

test("getSelectedNode returns null when nothing is selected", () => {
  const worktrees = [createWorktree("wt-1", "Feature")];
  const sessions = [createSession("sess-1", "Test Session", "wt-1")];
  const node = getSelectedNode(worktrees, sessions, null, null);
  expect(node).toBeNull();
});

test("getSelectedNode returns null for unknown node", () => {
  const worktrees = [createWorktree("wt-1", "Feature")];
  const sessions = [createSession("sess-1", "Test Session", "wt-1")];
  const node = getSelectedNode(worktrees, sessions, "unknown", "worktree");
  expect(node).toBeNull();
});
