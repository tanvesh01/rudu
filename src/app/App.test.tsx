import { test, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { App } from "./App.js";

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
