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
