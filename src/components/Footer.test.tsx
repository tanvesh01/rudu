import { test, expect, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { Footer } from "./Footer.js";

let testSetup: Awaited<ReturnType<typeof testRender>>;

afterEach(() => {
  if (testSetup) {
    testSetup.renderer.destroy();
  }
});

test("Footer shows list mode shortcuts", async () => {
  testSetup = await testRender(<Footer mode="list" />, { width: 120, height: 5 });
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Ctrl+N");
  expect(frame).toContain("Ctrl+C");
  expect(frame).toContain("Q Quit");
});

test("Footer shows prompt mode shortcuts", async () => {
  testSetup = await testRender(<Footer mode="prompt" />, { width: 80, height: 5 });
  await testSetup.renderOnce();
  const frame = testSetup.captureCharFrame();
  expect(frame).toContain("Enter Submit");
  expect(frame).toContain("Escape Cancel");
});
