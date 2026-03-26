import { test, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { App } from "./App.js";
import { CreateWorktreeDialog } from "../components/CreateWorktreeDialog.js";

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
