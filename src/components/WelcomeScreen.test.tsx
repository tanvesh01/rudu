import { test, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { WelcomeScreen } from "./WelcomeScreen.js";

let testSetup: Awaited<ReturnType<typeof testRender>>;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
  }
});

test("WelcomeScreen renders welcome message", async () => {
  testSetup = await testRender(
    <WelcomeScreen onCreateWorktree={() => {}} />,
    { width: 80, height: 24 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Welcome to Rudu");
});

test("WelcomeScreen shows no worktrees message", async () => {
  testSetup = await testRender(
    <WelcomeScreen onCreateWorktree={() => {}} />,
    { width: 80, height: 24 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("No worktrees yet");
});

test("WelcomeScreen advertises Ctrl+N shortcut", async () => {
  testSetup = await testRender(
    <WelcomeScreen onCreateWorktree={() => {}} />,
    { width: 80, height: 24 }
  );
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Ctrl+N");
});
