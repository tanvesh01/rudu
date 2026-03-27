import { test, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { CreateWorktreeDialog } from "./CreateWorktreeDialog.js";

let testSetup: Awaited<ReturnType<typeof testRender>>;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
  }
});

test("CreateWorktreeDialog renders title input", async () => {
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
});

test("CreateWorktreeDialog shows keyboard help", async () => {
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
  expect(frame).toContain("Enter Submit");
  expect(frame).toContain("Escape Cancel");
});

test("CreateWorktreeDialog displays creation error from parent", async () => {
  testSetup = await testRender(
    <CreateWorktreeDialog
      repoRoot="/home/user/projects/myrepo"
      defaultBranch="main"
      onSubmit={() => {}}
      onCancel={() => {}}
      error="Failed to create worktree: branch already exists"
    />,
    { width: 80, height: 24 }
  );
  await testSetup.renderOnce();

  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Error:");
  expect(frame).toContain("Failed to create worktree: branch already exists");
});

test("CreateWorktreeDialog shows loading state while creating", async () => {
  testSetup = await testRender(
    <CreateWorktreeDialog
      repoRoot="/home/user/projects/myrepo"
      defaultBranch="main"
      onSubmit={() => {}}
      onCancel={() => {}}
      isCreating={true}
    />,
    { width: 80, height: 24 }
  );
  await testSetup.renderOnce();

  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Creating worktree...");
  expect(frame).not.toContain("Enter Submit");
});
