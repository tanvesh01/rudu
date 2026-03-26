import { test, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { App, buildWorktreePiSessionInput } from "./App.js";
import { buildMissingPiSessionFileError } from "../services/SessionManager.js";
import { CreateWorktreeDialog } from "../components/CreateWorktreeDialog.js";
import { InMemorySessionRepository } from "../services/persistence/JsonlSessionRepository.js";
import { InMemoryWorktreeRepository } from "../services/persistence/SyncJsonlWorktreeRepository.js";

let testSetup: Awaited<ReturnType<typeof testRender>>;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
  }
});

test("App renders with Rudu header", async () => {
  testSetup = await testRender(<App />, { width: 120, height: 40 });
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Rudu");
});

test("App shows welcome screen when zero worktrees exist", async () => {
  testSetup = await testRender(<App />, { width: 120, height: 40 });
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Welcome to Rudu");
  expect(frame).toContain("No worktrees yet");
});

test("App shows footer with keyboard shortcuts", async () => {
  testSetup = await testRender(<App />, { width: 120, height: 40 });
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Ctrl+N");
  expect(frame).toContain("Q Quit");
});

test("CreateWorktreeDialog renders correctly when opened", async () => {
  testSetup = await testRender(
    <CreateWorktreeDialog
      repoRoot="/home/user/projects/myrepo"
      defaultBranch="main"
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
    { width: 80, height: 24 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Create New Worktree");
  expect(frame).toContain("Title:");
  expect(frame).toContain("Enter Submit");
  expect(frame).toContain("Escape Cancel");
});

test("CreateWorktreeDialog shows error when provided", async () => {
  testSetup = await testRender(
    <CreateWorktreeDialog
      repoRoot="/home/user/projects/myrepo"
      defaultBranch="main"
      onSubmit={() => {}}
      onCancel={() => {}}
      error="Failed to create worktree"
    />,
    { width: 80, height: 24 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Error:");
  expect(frame).toContain("Failed to create worktree");
});

test("buildWorktreePiSessionInput carries repoRoot/worktreePath for direct create-worktree flow", () => {
  const sessionId = crypto.randomUUID();
  const worktreeId = crypto.randomUUID();
  const input = buildWorktreePiSessionInput(
    {
      id: worktreeId,
      title: "Feature Branch",
      path: "/tmp/repo-feature-branch",
      repoRoot: "/tmp/repo",
    },
    sessionId,
  );

  expect(input.id).toBe(sessionId);
  expect(input.cwd).toBe("/tmp/repo-feature-branch");
  expect(input.repoRoot).toBe("/tmp/repo");
  expect(input.worktreePath).toBe("/tmp/repo-feature-branch");
  expect(input.metadata?.worktreeId).toBe(worktreeId);
});

test("App shows explicit PI history-unavailable message for selected session", async () => {
  const sessionRepository = new InMemorySessionRepository();
  const worktreeRepository = new InMemoryWorktreeRepository();
  const repoRoot = "/repo";
  const worktreePath = "/repo/worktree-a";
  const worktreeId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const missingFile = "/tmp/missing-pi-history.jsonl";

  worktreeRepository.insertWorktree({
    id: worktreeId,
    title: "Worktree A",
    path: worktreePath,
    branch: "feature/a",
    status: "active",
    repoRoot,
    isRuduManaged: true,
  });

  sessionRepository.insertSession({
    id: sessionId,
    title: "Session for Worktree A",
    runtimeType: "pi-sdk",
    status: "failed",
    originalCwd: worktreePath,
    effectiveCwd: worktreePath,
    repoRoot,
    worktreePath,
    worktreeId,
    worktreeStatus: "ready",
    cleanupPolicy: "preserve_on_failure",
    cleanupStatus: "none",
    piSessionFile: missingFile,
    canResume: false,
    recovered: true,
    lastError: buildMissingPiSessionFileError(missingFile),
    queuedAt: Date.now() - 1000,
    finishedAt: Date.now() - 500,
  });

  testSetup = await testRender(
    <App
      testOverrides={{
        repoContext: {
          type: "supported",
          repoRoot,
          defaultBranch: "main",
        },
        sessionRepository,
        worktreeRepository,
        skipReconciliation: true,
      }}
    />,
    { width: 120, height: 40 }
  );

  await testSetup.renderOnce();
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("History unavailable for this PI session.");
  expect(frame).toContain("PI session history unavailable: session file missing:");
});
